import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildAiObservation,
  buildPolicyValueInferenceInput,
  createCardInstance,
  createEmptyGameState,
  createTinyPolicyValueNetwork,
  calculateReduction,
  getFieldSymbolSources,
  getLegalActions,
  projectAiSearchCards,
  sanitizeStateForViewer,
  type Action,
  type CardDefinition,
  type Engine,
  type GameState,
  type TrainingDecisionNode,
} from "../src";
import type { CardFilter, DSL, Effect, TargetSpec } from "../src/dsl-types";
import {
  executeOverrideProperties,
  executeRegisterActAsSpirit,
} from "../src/effect/native-ce-registration-handlers";
import {
  executeEffectImmunity,
  executeEffectResistance,
  executeRestrictSymbolAddition,
} from "../src/effect/structured-continuous-effects";
import { executeEffect } from "../src/effect/effect-interpreter";
import { resolveTargetSpec } from "../src/effect/target-resolution";
import {
  resolveTargets,
  resolveTargetCandidateIds,
} from "../src/effect/native-target-resolution";
import { resolveAffectSourceIdentity } from "../src/effect/effect-source-identity";
import { isActiveTextRoleUnderEffectSource } from "../src/mechanics/star-garment-utils";
import { executeBpModify } from "../src/effect/structured-modifiers";
import { executeSymbolAdd } from "../src/effect/structured-combat";
import { matchesEffectResistanceFilter } from "../src/effect/effect-resistance-check";
import {
  evaluateStatelessSourceCount,
  getEffectiveCardName,
  getCandidateTargetInstanceIds,
  matchesGlobalCETargetFilter,
} from "../src/legal/legal-actions-shared";

const source: CardDefinition = {
  cardNo: "AI-PUBLIC-GRANT",
  name: "Public source",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [
    { level: 1, requiredCores: 1, bp: 3000 },
    { level: 2, requiredCores: 3, bp: 8000 },
  ],
  symbolColors: ["red"],
  tribe: "Public tribe",
  textLines: [],
  keywordTags: [],
};
const secretA: CardDefinition = {
  ...source,
  cardNo: "AI-SECRET-A",
  name: "Secret A",
  colors: ["purple"],
  tribe: "Secret tribe A",
  symbolColors: ["purple"],
};
const secretB: CardDefinition = {
  ...secretA,
  cardNo: "AI-SECRET-B",
  name: "Secret B",
  printedCategory: "ultimate",
  colors: ["blue"],
  cost: 9,
  levelDefs: [{ level: 1, requiredCores: 3, bp: 19000 }],
  tribe: "Secret tribe B",
  symbolColors: ["ultimate_symbol"],
};
const definitions = [source, secretA, secretB];
const engine: Engine = {
  cards: definitions,
  getCardDefinitionById: (id) => definitions.find((card) => card.cardNo === id),
  lookups: {} as Engine["lookups"],
};
const node: TrainingDecisionNode = {
  nodeId: "same-public-decision",
  kind: "legal_action",
  actingPlayerId: "alice",
  fields: [],
  choices: [
    {
      choiceId: "advance",
      label: "advance_step",
      systemAction: { kind: "advance_step", actingPlayerId: "alice" },
    },
  ],
  truncated: false,
};

function fixture(
  secret = secretA,
  bp = 7000,
  live = false,
  publicName?: string,
  publicSymbols: CardDefinition["symbolColors"] = ["red"],
  publicLevelDefs?: CardDefinition["levelDefs"]
): GameState {
  const hidden = createCardInstance(secret, {
    instanceId: "hidden-slot",
    ownerPlayerId: "bob",
    zone: "field",
    cores: 1,
  });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "public-source",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }),
      { ...hidden, faceDown: true },
    ],
  });
  const action: DSL.RegisterActAsSpiritAction = {
    kind: "register_act_as_spirit",
    target: { kind: "self" },
    ...(publicName !== undefined || publicLevelDefs !== undefined
      ? {
          overrides: {
            ...(publicName !== undefined ? { cardName: publicName } : {}),
            ...(publicLevelDefs !== undefined
              ? { levelDefs: publicLevelDefs }
              : {}),
          },
        }
      : {}),
    statBlueprint: live
      ? {
          kind: "live_copy_from_source",
          aspects: ["currentLv", "levelDefs", "symbolColors", "tribes"],
        }
      : {
          kind: "static_copy",
          snapshot: {
            cost: 2,
            reductionSymbols: [],
            symbolColors: publicSymbols,
            colors: ["yellow"],
            tribes: ["Granted tribe"],
            levelDefs: [{ level: 1, requiredCores: 1, bp }],
          },
        },
  };
  const effect: Effect = {
    timing: { kind: "activated", mode: "flash" },
    steps: [{ action }],
  };
  // Exercise the engine's real registration path, rather than inventing CE data.
  return executeRegisterActAsSpirit(
    action,
    state,
    "bob",
    "public-source",
    engine.getCardDefinitionById,
    effect,
    ["hidden-slot"]
  );
}

function observe(state: GameState, viewer = "alice") {
  return buildAiObservation({
    state,
    viewpointPlayerId: viewer,
    getCardDefinitionById: engine.getCardDefinitionById,
  });
}

function hiddenToken(state: GameState, viewer = "alice") {
  return observe(state, viewer).cards.find(
    (card) => card.instanceId === "hidden-slot"
  )!;
}

describe("AI observation of public grants on concealed field cards", () => {
  function coreMoveState(secret: CardDefinition): GameState {
    const state = fixture(secret, 7000, false, "Public granted name");
    return {
      ...state,
      step: "main",
      activePlayerId: "alice",
      players: state.players.map((player) => ({
        ...player,
        reserveNormalCoreCount: 4,
      })),
      cardInstances: [
        ...state.cardInstances.map((card) =>
          card.instanceId === "hidden-slot"
            ? { ...card, normalCoreCount: 2 }
            : card
        ),
        createCardInstance(source, {
          instanceId: "attacker",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
  }

  it.each([
    {
      label: "public name",
      filter: { cardName: { exact: "Public granted name" } },
      ids: ["hidden-slot"],
    },
    {
      label: "secret name",
      filter: { cardName: { exact: secretA.name } },
      ids: [],
    },
    {
      label: "public exclusion",
      filter: { exclude: { cardName: { exact: "Public granted name" } } },
      ids: ["public-source"],
    },
    {
      label: "secret exclusion",
      filter: { exclude: { cardName: { exact: secretA.name } } },
      ids: ["public-source", "hidden-slot"],
    },
  ] satisfies { label: string; filter: CardFilter; ids: string[] }[])(
    "core_move source candidates/disclosure use $label independently of printing/viewer",
    ({ filter, ids }) => {
      for (const secret of [secretA, secretB]) {
        const state = coreMoveState(secret);
        const sourceFilter: CardFilter = { category: ["spirit"], ...filter };
        const action: Extract<Action, { kind: "core_move" }> = {
          kind: "core_move",
          amount: 1,
          from: {
            kind: "field_card",
            player: "opponent",
            filter: sourceFilter,
          },
          to: { kind: "reserve", player: "opponent" },
        };
        for (const view of [
          state,
          sanitizeStateForViewer(state, "alice"),
          sanitizeStateForViewer(state, "bob"),
        ]) {
          expect(
            getCandidateTargetInstanceIds(
              view,
              "alice",
              {
                candidateTargetZones: ["field"],
                candidateTargetPlayerScope: "opponent",
                targetCardFilter: sourceFilter,
              },
              { getCardDefinitionById: engine.getCardDefinitionById }
            )
          ).toEqual(ids);
          expect(
            resolveTargets(
              action,
              view,
              "alice",
              "attacker",
              engine.getCardDefinitionById,
              {}
            )
          ).toEqual(ids);
          expect(
            resolveTargetCandidateIds(
              action,
              view,
              "alice",
              "attacker",
              engine.getCardDefinitionById,
              {}
            )
          ).toEqual(ids);
        }
      }
    }
  );

  for (const direction of ["source", "destination"] as const) {
    it.each([
      { label: "public name", name: "Public granted name", moved: true },
      { label: "secret A name", name: secretA.name, moved: false },
      { label: "secret B name", name: secretB.name, moved: false },
    ])(
      `core_move ${direction} resolves $label through final core movement in every view`,
      ({ name, moved }) => {
        for (const secret of [secretA, secretB]) {
          const state = coreMoveState(secret);
          const fieldLocation = {
            kind: "field_card",
            player: "opponent",
            filter: { category: ["spirit"], cardName: { exact: name } },
          } as const;
          const reserveLocation = {
            kind: "reserve",
            player: "opponent",
          } as const;
          const action: Extract<Action, { kind: "core_move" }> = {
            kind: "core_move",
            amount: 1,
            from: direction === "source" ? fieldLocation : reserveLocation,
            to: direction === "source" ? reserveLocation : fieldLocation,
          };
          const effect: Effect = {
            timing: { kind: "activated", mode: "main" },
            steps: [{ action }],
          };
          for (const view of [
            state,
            sanitizeStateForViewer(state, "alice"),
            sanitizeStateForViewer(state, "bob"),
          ]) {
            const after = executeEffect({
              chainId: `public-core-${direction}`,
              state: view,
              effect,
              sourceInstanceId: "attacker",
              actingPlayerId: "alice",
              getCardDefinitionById: engine.getCardDefinitionById,
            });
            const delta = moved ? (direction === "source" ? -1 : 1) : 0;
            expect(
              after.cardInstances.find(
                (card) => card.instanceId === "hidden-slot"
              )?.normalCoreCount
            ).toBe(2 + delta);
            expect(
              after.players.find((player) => player.id === "bob")
                ?.reserveNormalCoreCount
            ).toBe(4 - delta);
            expect(
              after.players.find((player) => player.id === "alice")
                ?.reserveNormalCoreCount
            ).toBe(4);
            expect(
              after.cardInstances.find(
                (card) => card.instanceId === "public-source"
              )?.normalCoreCount
            ).toBe(1);
            expect(after.pendingCoreSourceAllocation ?? null).toBeNull();
            expect(after.pendingStepOptionalTargetSelection ?? null).toBeNull();
          }
        }
      }
    );
  }

  it.each([
    {
      label: "public name",
      filter: { cardName: { exact: "Public granted name" } },
      ids: ["hidden-slot"],
    },
    {
      label: "secret name",
      filter: { cardName: { exact: secretA.name } },
      ids: [],
    },
    {
      label: "public exclusion",
      filter: { exclude: { cardName: { exact: "Public granted name" } } },
      ids: ["public-source"],
    },
    {
      label: "secret exclusion",
      filter: { exclude: { cardName: { exact: secretA.name } } },
      ids: ["public-source", "hidden-slot"],
    },
  ] satisfies { label: string; filter: CardFilter; ids: string[] }[])(
    "ordinary target candidates use $label independently of printing/viewer",
    ({ filter, ids }) => {
      for (const secret of [secretA, secretB]) {
        const state = fixture(secret, 7000, false, "Public granted name");
        for (const view of [
          state,
          sanitizeStateForViewer(state, "alice"),
          sanitizeStateForViewer(state, "bob"),
        ]) {
          expect(
            getCandidateTargetInstanceIds(
              view,
              "alice",
              {
                candidateTargetZones: ["field"],
                candidateTargetPlayerScope: "opponent",
                targetCardFilter: { category: ["spirit"], ...filter },
              },
              { getCardDefinitionById: engine.getCardDefinitionById }
            )
          ).toEqual(ids);
          expect(
            resolveTargetSpec({
              state: view,
              targetSpec: {
                kind: "filter",
                player: "opponent",
                zone: "field",
                count: "all",
                filter: { category: ["spirit"], ...filter },
              },
              actingPlayerId: "alice",
              sourceInstanceId: "public-source",
              getCardDefinitionById: engine.getCardDefinitionById,
            }).map((card) => card.instanceId)
          ).toEqual(ids);
        }
      }
    }
  );

  it.each([secretA, secretB])(
    "public named target survives on_step selection and revalidation ($cardNo)",
    (secret) => {
      const granted = fixture(secret, 7000, false, source.name);
      const state: GameState = {
        ...granted,
        cardInstances: [
          ...granted.cardInstances,
          createCardInstance(source, {
            instanceId: "attacker",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            targetSelectionTiming: "on_step",
            action: {
              kind: "bp_modify",
              amount: 1000,
              duration: { scope: "turn" },
              target: {
                kind: "filter",
                player: "opponent",
                zone: "field",
                count: 1,
                filter: {
                  category: ["spirit"],
                  cardName: { exact: source.name },
                },
              },
            },
          },
        ],
      };
      const pending = executeEffect({
        chainId: "public-name-on-step",
        state,
        effect,
        sourceInstanceId: "attacker",
        actingPlayerId: "alice",
        getCardDefinitionById: engine.getCardDefinitionById,
      });
      expect(
        pending.pendingStepOptionalTargetSelection?.candidateInstanceIds
      ).toEqual(["public-source", "hidden-slot"]);
      const lookups = {
        getCardDefinitionById: engine.getCardDefinitionById,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      };
      // Only the chooser's view exposes the pending input; Bob's projection
      // deliberately hides Alice's pending decision.
      for (const view of [pending, sanitizeStateForViewer(pending, "alice")]) {
        const action = getLegalActions({
          state: view,
          actingPlayerId: "alice",
          ...lookups,
        }).find(
          (entry) =>
            entry.kind === "resolve_pending_step_optional_target_selection"
        )!;
        expect(action).toMatchObject({
          can: true,
          candidateTargetInstanceIds: ["public-source", "hidden-slot"],
        });
        const after = applyLegalAction({
          state: view,
          action,
          targetInstanceIds: ["hidden-slot"],
          ...lookups,
        }).state;
        expect(after.pendingStepOptionalTargetSelection).toBeNull();
        expect(hiddenToken(after).effectiveBp).toBe(8000);
        expect(hiddenToken(after, "bob").effectiveBp).toBe(8000);
        expect(
          observe(after).cards.find(
            (card) => card.instanceId === "public-source"
          )?.effectiveBp
        ).toBe(3000);
      }
    }
  );

  it("retains additive public identity while printed identity stays unknown", () => {
    const state = fixture();
    expect(hiddenToken(state)).toMatchObject({
      identityVisibility: "unknown",
      cardNoOrUnknown: "UNK_CARD",
      minimumRequiredCores: 0,
      zoneRoleName: "field",
      effectiveCategory: "spirit",
      effectiveLevel: 1,
      effectiveBp: 7000,
      effectiveSymbols: ["red"],
      effectiveSymbolBundles: [{ colors: ["red"], count: 1 }],
      effectiveColors: ["yellow"],
      effectiveTribes: ["Granted tribe"],
    });
    const owner = hiddenToken(state, "bob");
    expect(owner.identityVisibility).toBe("known");
    expect(owner.effectiveBp).toBe(7000);
    expect(owner.effectiveColors).toEqual(["yellow"]);
    expect(projectAiSearchCards(observe(state))[1]).toMatchObject({
      effectiveCategory: "spirit",
      effectiveBp: 7000,
    });
  });

  it("different secret printing cannot change observation, search or NN", () => {
    const a = fixture(secretA);
    const b = fixture(secretB);
    const beforeA = structuredClone(a);
    const beforeB = structuredClone(b);
    expect(observe(a)).toEqual(observe(b));
    expect(projectAiSearchCards(observe(a))).toEqual(
      projectAiSearchCards(observe(b))
    );
    const inputA = buildPolicyValueInferenceInput({ state: a, node, engine });
    const inputB = buildPolicyValueInferenceInput({ state: b, node, engine });
    expect(inputA).toEqual(inputB);
    const nn = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
    expect(nn.predict(inputA)).toEqual(nn.predict(inputB));
    expect(a).toEqual(beforeA);
    expect(b).toEqual(beforeB);
  });

  it("a public BP change reaches search and the existing NN inference route", () => {
    const a = fixture(secretA, 7000);
    const b = fixture(secretA, 9000);
    expect(hiddenToken(b).effectiveBp).toBe(9000);
    expect(projectAiSearchCards(observe(a))).not.toEqual(
      projectAiSearchCards(observe(b))
    );
    const inputA = buildPolicyValueInferenceInput({ state: a, node, engine });
    const inputB = buildPolicyValueInferenceInput({ state: b, node, engine });
    expect(inputA).not.toEqual(inputB);
    const nn = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
    expect(nn.predict(inputA).value).not.toBe(nn.predict(inputB).value);
  });

  it("removing a grant restores null identity without revealing printing", () => {
    const a = { ...fixture(secretA), activeContinuousEffects: [] };
    const b = { ...fixture(secretB), activeContinuousEffects: [] };
    const token = hiddenToken(a);
    expect(token.effectiveCategory).toBeUndefined();
    expect(token.effectiveBp ?? 0).toBe(0);
    expect(token.effectiveLevel ?? 0).toBe(0);
    expect(token.effectiveColors).toEqual([]);
    expect(token.effectiveTribes).toEqual([]);
    expect(token.effectiveSymbols).toEqual([]);
    expect(observe(a)).toEqual(observe(b));
  });

  it("live grants follow the public source's current level and BP", () => {
    const state = fixture(secretB, 7000, true);
    const changed = {
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "public-source"
          ? { ...card, normalCoreCount: 3 }
          : card
      ),
    };
    expect(hiddenToken(state)).toMatchObject({
      effectiveLevel: 1,
      effectiveBp: 3000,
      effectiveSymbols: ["red"],
      effectiveTribes: ["Public tribe"],
    });
    expect(hiddenToken(changed)).toMatchObject({
      effectiveLevel: 2,
      effectiveBp: 8000,
    });
  });

  it("does not restore grants removed by the shared viewer sanitizer", () => {
    const concealSource = (state: GameState): GameState => ({
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "public-source" ? { ...card, faceDown: true } : card
      ),
    });
    const a = concealSource(fixture(secretA, 7000));
    const b = concealSource(fixture(secretB, 9000));
    expect(hiddenToken(a).effectiveCategory).toBeUndefined();
    expect(hiddenToken(a).effectiveBp ?? 0).toBe(0);
    expect(observe(a)).toEqual(observe(b));
  });

  it("never looks up the concealed card's true definition", () => {
    const state = fixture(secretB);
    const observation = buildAiObservation({
      state,
      viewpointPlayerId: "alice",
      getCardDefinitionById: (id) => {
        expect([secretA.cardNo, secretB.cardNo]).not.toContain(id);
        return engine.getCardDefinitionById(id);
      },
    });
    expect(observation.cards[1]?.effectiveBp).toBe(7000);
  });

  it.each([1000, 3000])(
    "public global BP +%i reaches both viewers, search and NN without secret printing",
    (amount) => {
      const boost = (state: GameState) =>
        executeBpModify(
          state,
          "bob",
          {
            target: { player: "self", category: ["spirit"], count: -1 },
            amount,
            duration: { scope: "turn" },
          },
          "public-source",
          engine.getCardDefinitionById
        );
      const a = boost(fixture(secretA));
      const b = boost(fixture(secretB));
      const expected = 7000 + amount;
      expect(a.activeContinuousEffects).toHaveLength(2);
      expect(hiddenToken(a, "bob").effectiveBp).toBe(expected);
      expect.soft(hiddenToken(a).effectiveBp).toBe(expected);
      expect
        .soft(projectAiSearchCards(observe(a))[1]?.effectiveBp)
        .toBe(expected);
      expect(observe(a)).toEqual(observe(b));
      const inputA = buildPolicyValueInferenceInput({ state: a, node, engine });
      const inputB = buildPolicyValueInferenceInput({ state: b, node, engine });
      const base = buildPolicyValueInferenceInput({
        state: fixture(),
        node,
        engine,
      });
      expect(inputA).toEqual(inputB);
      expect(inputA).not.toEqual(base);
      const slot = inputA.observation.cardInstanceIds.indexOf("hidden-slot");
      expect(slot).toBeGreaterThanOrEqual(0);
      expect(inputA.observation.cards[slot]?.features).not.toEqual(
        base.observation.cards[slot]?.features
      );
      const nn = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
      expect(nn.predict(inputA)).toEqual(nn.predict(inputB));
      const removed: GameState = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "bp_modifier"
        ),
      };
      expect(hiddenToken(removed).effectiveBp).toBe(7000);
      expect(
        buildPolicyValueInferenceInput({ state: removed, node, engine })
      ).toEqual(base);
    }
  );

  it.each(["hand", "deck", "field", "dangling"] as const)(
    "does not invent spirit identity for a concealed %s without a public grant",
    (zone) => {
      const original = fixture();
      const state = sanitizeStateForViewer(
        {
          ...original,
          activeContinuousEffects: [],
          cardInstances: original.cardInstances.map((card) =>
            card.instanceId === "hidden-slot"
              ? { ...card, zone: zone === "dangling" ? "field" : zone }
              : card
          ),
        },
        "alice"
      );
      const target = state.cardInstances.find(
        (card) => card.instanceId === "hidden-slot"
      )!;
      const ce = executeBpModify(
        original,
        "bob",
        {
          target: { player: "self", category: ["spirit"], count: -1 },
          amount: 1000,
          duration: { scope: "turn" },
        },
        "public-source",
        engine.getCardDefinitionById
      ).activeContinuousEffects.find(
        (effect) => effect.modifierTag === "bp_modifier"
      )!;
      expect(
        matchesGlobalCETargetFilter(
          zone === "dangling"
            ? {
                ...state,
                cardInstances: state.cardInstances.filter(
                  (card) => card.instanceId !== "hidden-slot"
                ),
              }
            : state,
          ce,
          target,
          engine.getCardDefinitionById
        )
      ).toBe(false);
      expect(
        matchesEffectResistanceFilter(
          zone === "dangling"
            ? {
                ...state,
                cardInstances: state.cardInstances.filter(
                  (card) => card.instanceId !== "hidden-slot"
                ),
              }
            : state,
          ce,
          target,
          engine.getCardDefinitionById
        )
      ).toBe(false);
      expect(
        evaluateStatelessSourceCount(
          state,
          "bob",
          {
            kind: "cards_in_zone",
            player: "self",
            zone: zone === "dangling" ? "field" : zone,
            filter: { category: ["spirit"] },
          },
          engine.getCardDefinitionById
        )
      ).toBe(zone === "field" || zone === "dangling" ? 1 : 0);
      expect(
        evaluateStatelessSourceCount(
          state,
          "bob",
          {
            kind: "field_bp_total",
            player: "self",
            filter: { category: ["spirit"] },
          },
          engine.getCardDefinitionById
        )
      ).toBe(3000);
    }
  );

  it("global filters use public granted colors and the controller axis", () => {
    const boost = (player: "self" | "opponent", color: "yellow" | "purple") =>
      executeBpModify(
        fixture(),
        "bob",
        {
          target: { player, category: ["spirit"], colors: [color], count: -1 },
          amount: 1000,
          duration: { scope: "turn" },
        },
        "public-source",
        engine.getCardDefinitionById
      );
    expect(hiddenToken(boost("self", "yellow")).effectiveBp).toBe(8000);
    expect(hiddenToken(boost("self", "purple")).effectiveBp).toBe(7000);
    expect(hiddenToken(boost("opponent", "yellow")).effectiveBp).toBe(7000);
  });

  it.each(["self", "any", "opponent"] as const)(
    "public global immunity (%s) retains the same BP and NN input for both secret worlds",
    (sourcePlayerScope) => {
      const protectedState = (secret: CardDefinition) => {
        const immune = executeEffectImmunity(
          fixture(secret),
          "bob",
          {
            target: {
              player: "self",
              category: ["spirit"],
              zone: ["field"],
              count: -1,
            },
            duration: { scope: "turn" },
            sourcePlayerScope,
          },
          "public-source",
          engine.getCardDefinitionById
        );
        expect(
          immune.activeContinuousEffects.find(
            (ce) => ce.modifierTag === "defense_immune"
          )?.targetFilter
        ).toBeDefined();
        return executeBpModify(
          immune,
          "bob",
          {
            target: { player: "self", category: ["spirit"], count: -1 },
            amount: 1000,
            duration: { scope: "turn" },
          },
          "public-source",
          engine.getCardDefinitionById
        );
      };
      const a = protectedState(secretA);
      const b = protectedState(secretB);
      const expected = sourcePlayerScope === "opponent" ? 8000 : 7000;
      expect(hiddenToken(a, "bob").effectiveBp).toBe(expected);
      expect(hiddenToken(a).effectiveBp).toBe(expected);
      expect(projectAiSearchCards(observe(a))[1]?.effectiveBp).toBe(expected);
      expect(observe(a)).toEqual(observe(b));
      expect(
        buildPolicyValueInferenceInput({ state: a, node, engine })
      ).toEqual(buildPolicyValueInferenceInput({ state: b, node, engine }));
      const removed = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "defense_immune"
        ),
      };
      expect(hiddenToken(removed, "bob").effectiveBp).toBe(8000);
      expect(hiddenToken(removed).effectiveBp).toBe(8000);
    }
  );

  it("public global cannot_include still excludes the hidden spirit from global BP", () => {
    const locked = executeEffectResistance(
      fixture(),
      "bob",
      {
        kind: "effect_resistance",
        target: { player: "self", category: ["spirit"], count: -1 },
        duration: { scope: "turn" },
        resistType: "cannot_include",
        source: "all",
      },
      "public-source",
      engine.getCardDefinitionById
    );
    expect(
      locked.activeContinuousEffects.find(
        (ce) => ce.modifierTag === "cannot_include"
      )?.targetFilter
    ).toBeDefined();
    const boosted = executeBpModify(
      locked,
      "bob",
      {
        target: { player: "self", category: ["spirit"], count: -1 },
        amount: 1000,
        duration: { scope: "turn" },
      },
      "public-source",
      engine.getCardDefinitionById
    );
    expect(hiddenToken(boosted, "bob").effectiveBp).toBe(7000);
    expect(hiddenToken(boosted).effectiveBp).toBe(7000);
    const removed = {
      ...boosted,
      activeContinuousEffects: boosted.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "cannot_include"
      ),
    };
    expect(hiddenToken(removed).effectiveBp).toBe(8000);
  });

  it.each([
    { symbolCount: 1 },
    { minSymbolCount: 1 },
    { maxSymbolCount: 1 },
    { minBp: 6000, maxBp: 8000 },
    { minLevel: 1 },
    { maxLevel: 1 },
    { filterOr: [{ symbolCount: 1 }] },
  ])("global immunity evaluates public effective attributes %j", (filter) => {
    const protect = (secret: CardDefinition) => {
      const immune = executeEffectImmunity(
        fixture(secret),
        "bob",
        {
          target: {
            player: "self",
            count: -1,
            filter: { category: ["spirit"], zone: ["field"], ...filter },
          },
          duration: { scope: "turn" },
          sourcePlayerScope: "self",
        },
        "public-source",
        engine.getCardDefinitionById
      );
      return executeBpModify(
        immune,
        "bob",
        {
          target: { player: "self", category: ["spirit"], count: -1 },
          amount: 1000,
          duration: { scope: "turn" },
        },
        "public-source",
        engine.getCardDefinitionById
      );
    };
    const a = protect(secretA);
    const b = protect(secretB);
    expect(hiddenToken(a, "bob").effectiveBp).toBe(7000);
    expect(hiddenToken(a).effectiveBp).toBe(7000);
    expect(observe(a)).toEqual(observe(b));
    expect(projectAiSearchCards(observe(a))[1]?.effectiveBp).toBe(7000);
    const input = buildPolicyValueInferenceInput({ state: a, node, engine });
    const reference = buildPolicyValueInferenceInput({
      state: fixture(),
      node,
      engine,
    });
    const slot = input.observation.cardInstanceIds.indexOf("hidden-slot");
    expect(input.observation.cards[slot]?.features).toEqual(
      reference.observation.cards[slot]?.features
    );
    expect(input).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
    const released = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "defense_immune"
      ),
    };
    expect(hiddenToken(released, "bob").effectiveBp).toBe(8000);
    expect(hiddenToken(released).effectiveBp).toBe(8000);
  });

  it.each([false, true])(
    "dynamic public spirit count retains concealed grants (yellow-only=%s)",
    (yellowOnly) => {
      const boost = (secret: CardDefinition) =>
        executeBpModify(
          fixture(secret),
          "bob",
          {
            target: { player: "self", category: ["spirit"], count: -1 },
            amount: 0,
            dynamicAmount: {
              source: {
                kind: "cards_in_zone",
                zone: "field",
                player: "self",
                filter: {
                  category: ["spirit"],
                  ...(yellowOnly ? { colors: ["yellow"] } : {}),
                },
              },
              multiplier: 1000,
            },
            duration: { scope: "turn" },
          },
          "public-source",
          engine.getCardDefinitionById
        );
      const a = boost(secretA);
      const b = boost(secretB);
      const expected = yellowOnly ? 8000 : 9000;
      expect(hiddenToken(a, "bob").effectiveBp).toBe(expected);
      expect(hiddenToken(a).effectiveBp).toBe(expected);
      expect(observe(a)).toEqual(observe(b));
      expect(projectAiSearchCards(observe(a))[1]?.effectiveBp).toBe(expected);
      expect(
        buildPolicyValueInferenceInput({ state: a, node, engine })
      ).toEqual(buildPolicyValueInferenceInput({ state: b, node, engine }));
      const expanded = {
        ...a,
        cardInstances: [
          ...a.cardInstances,
          createCardInstance(source, {
            instanceId: "another-public-spirit",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      };
      expect(hiddenToken(expanded).effectiveBp).toBe(yellowOnly ? 8000 : 10000);
      const released = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "act_as_spirit"
        ),
      };
      expect(hiddenToken(released).effectiveCategory).toBeUndefined();
      expect(hiddenToken(released).effectiveBp).toBe(0);
      expect(
        observe(released).cards.find(
          (card) => card.instanceId === "public-source"
        )?.effectiveBp
      ).toBe(yellowOnly ? 3000 : 4000);
    }
  );

  it("dynamic public BP total retains a concealed source spirit", () => {
    const boost = (secret: CardDefinition) => {
      const initial = fixture(secret);
      const state = {
        ...initial,
        cardInstances: [
          ...initial.cardInstances,
          createCardInstance(source, {
            instanceId: "viewer-target",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      };
      return executeBpModify(
        state,
        "alice",
        {
          target: { player: "self", category: ["spirit"], count: 1 },
          amount: 0,
          dynamicAmount: {
            source: {
              kind: "field_bp_total",
              player: "opponent",
              filter: { category: ["spirit"] },
            },
            multiplier: 1,
            divisor: 10,
          },
          duration: { scope: "turn" },
        },
        "viewer-target",
        engine.getCardDefinitionById,
        ["viewer-target"]
      );
    };
    const a = boost(secretA);
    const b = boost(secretB);
    const targetBp = (state: GameState, viewer: string) =>
      observe(state, viewer).cards.find(
        (card) => card.instanceId === "viewer-target"
      )?.effectiveBp;
    expect(targetBp(a, "bob")).toBe(4000);
    expect(targetBp(a, "alice")).toBe(4000);
    expect(observe(a)).toEqual(observe(b));
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
    const changedSource = {
      ...a,
      cardInstances: a.cardInstances.map((card) =>
        card.instanceId === "public-source"
          ? { ...card, normalCoreCount: 3 }
          : card
      ),
    };
    expect(targetBp(changedSource, "alice")).toBe(4500);
    expect(targetBp(changedSource, "bob")).toBe(4500);
    expect(
      buildPolicyValueInferenceInput({ state: changedSource, node, engine })
    ).not.toEqual(buildPolicyValueInferenceInput({ state: a, node, engine }));
    const released = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "act_as_spirit"
      ),
    };
    expect(targetBp(released, "alice")).toBe(3300);
    expect(targetBp(released, "bob")).toBe(3300);
  });

  it("a symbol-conditioned global tribe grant does not re-enter its own filter", () => {
    const build = (secret: CardDefinition) => {
      const action: DSL.OverridePropertiesAction = {
        kind: "override_properties",
        target: {
          kind: "filter",
          player: "self",
          zone: "field",
          count: "all",
          filter: { category: ["spirit"], symbolCount: 1 },
        },
        properties: { addTribes: ["Public additional tribe"] },
        duration: { scope: "turn" },
      };
      return executeOverrideProperties(
        action,
        fixture(secret),
        "bob",
        "public-source",
        engine.getCardDefinitionById,
        { timing: { kind: "continuous" }, steps: [{ action }] }
      );
    };
    const a = build(secretA);
    const b = build(secretB);
    expect(hiddenToken(a).effectiveTribes).toEqual([
      "Granted tribe",
      "Public additional tribe",
    ]);
    expect(hiddenToken(a, "bob").effectiveTribes).toEqual(
      hiddenToken(a).effectiveTribes
    );
    expect(observe(a)).toEqual(observe(b));
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
    const released = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "override_properties"
      ),
    };
    expect(hiddenToken(released).effectiveTribes).toEqual(["Granted tribe"]);
  });

  it.each<{
    label: string;
    filter: CardFilter;
    expected: number;
    publicName?: string;
  }>([
    {
      label: "public exact",
      filter: { cardName: { exact: "Public granted name" } },
      expected: 7000,
      publicName: "Public granted name",
    },
    {
      label: "secret exact with public name",
      filter: { cardName: { exact: secretA.name } },
      expected: 8000,
      publicName: "Public granted name",
    },
    {
      label: "absent public name",
      filter: { cardName: { exact: "Public granted name" } },
      expected: 8000,
    },
    {
      label: "secret exact without public name",
      filter: { cardName: { exact: secretA.name } },
      expected: 8000,
    },
    {
      label: "public name in OR",
      filter: { filterOr: [{ cardName: { exact: "Public granted name" } }] },
      expected: 7000,
      publicName: "Public granted name",
    },
    {
      label: "public tribe in OR snapshot",
      filter: {
        filterOr: [{ category: ["spirit"], tribes: ["Granted tribe"] }],
      },
      expected: 7000,
    },
    {
      label: "secret name in OR snapshot",
      filter: { filterOr: [{ cardName: { exact: secretA.name } }] },
      expected: 8000,
      publicName: "Public granted name",
    },
    {
      label: "secret tribe in OR snapshot",
      filter: {
        filterOr: [{ category: ["spirit"], tribes: ["Secret tribe A"] }],
      },
      expected: 8000,
    },
    {
      label: "exclude public name",
      filter: { excludeCardName: { exact: "Public granted name" } },
      expected: 8000,
      publicName: "Public granted name",
    },
    {
      label: "exclude secret name",
      filter: { excludeCardName: { exact: secretA.name } },
      expected: 7000,
      publicName: "Public granted name",
    },
    {
      label: "nested public name exclusion",
      filter: { exclude: { cardName: { exact: "Public granted name" } } },
      expected: 8000,
      publicName: "Public granted name",
    },
    {
      label: "same public name as source",
      filter: { cardName: "self" },
      expected: 7000,
      publicName: source.name,
    },
  ])(
    "name-conditioned immunity uses $label",
    ({ filter, expected, publicName }) => {
      const build = (secret: CardDefinition) => {
        const granted = fixture(secret, 7000, false, publicName);
        expect(
          granted.activeContinuousEffects.filter(
            (ce) => ce.modifierTag === "act_as_spirit"
          )
        ).toHaveLength(1);
        if (publicName !== undefined) {
          expect(
            getEffectiveCardName(
              granted,
              granted.cardInstances[1]!,
              secret,
              engine.getCardDefinitionById
            )
          ).toBe(publicName);
        }
        const immune = executeEffectImmunity(
          granted,
          "bob",
          {
            target: {
              player: "self",
              count: -1,
              filter: { category: ["spirit"], zone: ["field"], ...filter },
            },
            duration: { scope: "turn" },
            sourcePlayerScope: "self",
          },
          "public-source",
          engine.getCardDefinitionById
        );
        return executeBpModify(
          immune,
          "bob",
          {
            target: { player: "self", category: ["spirit"], count: -1 },
            amount: 1000,
            duration: { scope: "turn" },
          },
          "public-source",
          engine.getCardDefinitionById
        );
      };
      const a = build(secretA);
      const b = build(secretB);
      expect(hiddenToken(a).effectiveBp).toBe(expected);
      expect(hiddenToken(a, "bob").effectiveBp).toBe(expected);
      expect(observe(a)).toEqual(observe(b));
      expect(projectAiSearchCards(observe(a))).toEqual(
        projectAiSearchCards(observe(b))
      );
      const inputA = buildPolicyValueInferenceInput({ state: a, node, engine });
      expect(inputA).toEqual(
        buildPolicyValueInferenceInput({ state: b, node, engine })
      );
      const slot = inputA.observation.cardInstanceIds.indexOf("hidden-slot");
      expect(inputA.observation.cards[slot]?.features[37]).toBe(
        expected / 20000
      );
      const released = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "defense_immune"
        ),
      };
      expect(hiddenToken(released).effectiveBp).toBe(8000);
      const ungranted = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "act_as_spirit"
        ),
      };
      expect(hiddenToken(ungranted).effectiveBp).toBe(0);
    }
  );

  it.each([true, false])(
    "global BP name conditions use public names (matching=%s)",
    (matching) => {
      const build = (secret: CardDefinition) =>
        executeBpModify(
          fixture(secret, 7000, false, "Public granted name"),
          "bob",
          {
            target: {
              player: "self",
              count: -1,
              filter: {
                category: ["spirit"],
                zone: ["field"],
                cardName: {
                  exact: matching ? "Public granted name" : secretA.name,
                },
              },
            },
            amount: 1000,
            duration: { scope: "turn" },
          },
          "public-source",
          engine.getCardDefinitionById
        );
      const a = build(secretA);
      const b = build(secretB);
      const expected = matching ? 8000 : 7000;
      expect(hiddenToken(a).effectiveBp).toBe(expected);
      expect(hiddenToken(a, "bob").effectiveBp).toBe(expected);
      expect(observe(a)).toEqual(observe(b));
      expect(
        buildPolicyValueInferenceInput({ state: a, node, engine })
      ).toEqual(buildPolicyValueInferenceInput({ state: b, node, engine }));
    }
  );

  it.each([
    ["cards_in_zone", true],
    ["cards_in_zone", false],
    ["field_bp_total", true],
    ["field_bp_total", false],
  ] as const)(
    "dynamic %s name filters retain only public identity (matching=%s)",
    (kind, matching) => {
      const build = (secret: CardDefinition) => {
        const granted = fixture(secret, 7000, false, "Public granted name");
        const state = {
          ...granted,
          cardInstances: [
            ...granted.cardInstances,
            createCardInstance(source, {
              instanceId: "viewer-target",
              ownerPlayerId: "alice",
              zone: "field",
              cores: 1,
            }),
          ],
        };
        const filter: CardFilter = {
          category: ["spirit"],
          cardName: { exact: matching ? "Public granted name" : secretA.name },
        };
        return executeBpModify(
          state,
          "alice",
          {
            target: { player: "self", category: ["spirit"], count: 1 },
            amount: 0,
            dynamicAmount: {
              source:
                kind === "cards_in_zone"
                  ? {
                      kind: "cards_in_zone",
                      zone: "field",
                      player: "opponent",
                      filter,
                    }
                  : { kind: "field_bp_total", player: "opponent", filter },
              multiplier: kind === "cards_in_zone" ? 1000 : 1,
              ...(kind === "field_bp_total" ? { divisor: 10 } : {}),
            },
            duration: { scope: "turn" },
          },
          "viewer-target",
          engine.getCardDefinitionById,
          ["viewer-target"]
        );
      };
      const a = build(secretA);
      const b = build(secretB);
      const expected = matching
        ? kind === "cards_in_zone"
          ? 4000
          : 3700
        : 3000;
      for (const viewer of ["alice", "bob"]) {
        expect(
          observe(a, viewer).cards.find(
            (card) => card.instanceId === "viewer-target"
          )?.effectiveBp
        ).toBe(expected);
      }
      expect(observe(a)).toEqual(observe(b));
      expect(
        buildPolicyValueInferenceInput({ state: a, node, engine })
      ).toEqual(buildPolicyValueInferenceInput({ state: b, node, engine }));
    }
  );

  it("dynamic symbol additions count publicly granted spirits without re-entry", () => {
    const build = (secret: CardDefinition) =>
      executeSymbolAdd(
        fixture(secret),
        "bob",
        {
          target: { player: "self", category: ["spirit"], count: -1 },
          symbol: "blue",
          count: {
            source: {
              kind: "cards_in_zone",
              zone: "field",
              player: "self",
              filter: { category: ["spirit"], minSymbolCount: 1 },
            },
            multiplier: 1,
          },
          duration: { scope: "turn" },
          continuousTarget: {
            kind: "filter",
            player: "self",
            zone: "field",
            count: "all",
            filter: { category: ["spirit"] },
          },
        },
        "public-source",
        engine.getCardDefinitionById
      );
    const a = build(secretA);
    const b = build(secretB);
    const symbolCount = (state: GameState, viewer = "alice") =>
      hiddenToken(state, viewer).effectiveSymbolBundles.reduce(
        (sum, bundle) => sum + bundle.count,
        0
      );
    expect(symbolCount(a)).toBe(3);
    expect(symbolCount(a, "bob")).toBe(3);
    expect(observe(a)).toEqual(observe(b));
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
    const expanded = {
      ...a,
      cardInstances: [
        ...a.cardInstances,
        createCardInstance(source, {
          instanceId: "another-public-symbol",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    };
    expect(symbolCount(expanded)).toBe(4);
    const released = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "symbol_addition"
      ),
    };
    expect(symbolCount(released)).toBe(1);
  });

  it.each([false, true])(
    "field symbol-color union retains public concealed sources (global=%s)",
    (global) => {
      const continuousTarget: NonNullable<
        Parameters<typeof executeSymbolAdd>[2]["continuousTarget"]
      > = {
        kind: "filter",
        player: "self",
        zone: "field",
        count: "all",
        filter: { category: ["spirit"] },
      };
      const copy = (
        state: GameState,
        symbols?: CardDefinition["symbolColors"]
      ) =>
        executeSymbolAdd(
          state,
          "bob",
          {
            target: {
              player: "self",
              category: ["spirit"],
              count: global ? -1 : 1,
            },
            ...(symbols !== undefined
              ? { symbol: symbols }
              : {
                  symbolSource: {
                    kind: "field_colors_present" as const,
                    player: "self" as const,
                  },
                }),
            duration: { scope: "turn" },
            ...(global ? { continuousTarget } : {}),
          },
          "public-source",
          engine.getCardDefinitionById,
          global ? undefined : ["public-source"]
        );
      const base = (secret: CardDefinition) =>
        fixture(secret, 7000, false, undefined, ["blue"]);
      const before = base(secretA);
      expect(
        before.activeContinuousEffects.filter(
          (ce) => ce.modifierTag === "act_as_spirit"
        )
      ).toHaveLength(1);
      expect(hiddenToken(before).effectiveSymbols).toEqual(["blue"]);
      expect(hiddenToken(before, "bob").effectiveSymbols).toEqual(["blue"]);
      const a = copy(before);
      const b = copy(base(secretB));
      expect(
        a.activeContinuousEffects.find(
          (ce) => ce.modifierTag === "symbol_addition"
        )?.modifierSymbolSource
      ).toEqual({ kind: "field_colors_present", playerId: "bob" });
      const bundles = (state: GameState, viewer = "alice") =>
        observe(state, viewer).cards.find(
          (card) => card.instanceId === "public-source"
        )!.effectiveSymbolBundles;
      const expected = [
        { colors: ["red"], count: 1 },
        { colors: ["red", "blue"], count: 1 },
      ];
      expect(bundles(a, "bob")).toEqual(expected);
      expect(bundles(a)).toEqual(expected);
      const masked = sanitizeStateForViewer(a, "alice");
      const publicSources = getFieldSymbolSources({
        state: masked,
        actingPlayerId: "bob",
        getCardDefinitionById: engine.getCardDefinitionById,
      });
      const ownedSources = getFieldSymbolSources({
        state: a,
        actingPlayerId: "bob",
        getCardDefinitionById: engine.getCardDefinitionById,
      });
      expect(
        publicSources.map(({ sourceInstanceId, symbolEntries }) => ({
          sourceInstanceId,
          symbolEntries,
        }))
      ).toEqual(
        ownedSources.map(({ sourceInstanceId, symbolEntries }) => ({
          sourceInstanceId,
          symbolEntries,
        }))
      );
      expect(
        publicSources.find(
          (source) => source.sourceInstanceId === "hidden-slot"
        )?.sourceDefinitionId
      ).toBe("_hidden_card_");
      const payingCard: CardDefinition = {
        ...source,
        cardNo: "AI-PUBLIC-PAYMENT",
        printedCategory: "magic",
        cost: 4,
        reductionSymbols: ["red", "blue", "blue", "blue"],
        levelDefs: [],
        symbolColors: [],
      };
      const payment = (state: GameState) =>
        calculateReduction({
          state,
          actingPlayerId: "bob",
          card: payingCard,
          getCardDefinitionById: engine.getCardDefinitionById,
        });
      expect(payment(masked).totalReduction).toBe(global ? 4 : 3);
      expect(payment(masked).finalCost).toBe(global ? 0 : 1);
      expect(payment(masked).reductionBreakdown).toEqual(
        payment(a).reductionBreakdown
      );
      expect(observe(a)).toEqual(observe(b));
      expect(projectAiSearchCards(observe(a))).toEqual(
        projectAiSearchCards(observe(b))
      );
      const inputA = buildPolicyValueInferenceInput({ state: a, node, engine });
      expect(inputA).toEqual(
        buildPolicyValueInferenceInput({ state: b, node, engine })
      );
      const sourceFeatures = (state: GameState) => {
        const input = buildPolicyValueInferenceInput({ state, node, engine });
        const slot = input.observation.cardInstanceIds.indexOf("public-source");
        expect(slot).toBeGreaterThanOrEqual(0);
        return input.observation.cards[slot]!.features;
      };
      // A fixed public compound-symbol grant is an independent current-value
      // reference; future dynamic/static CE semantics are not equated here.
      expect(sourceFeatures(a)).toEqual(
        sourceFeatures(copy(base(secretA), ["red", "blue"]))
      );
      const released = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "act_as_spirit"
        ),
      };
      expect(bundles(released)).toEqual([{ colors: ["red"], count: 2 }]);
      expect(bundles(released, "bob")).toEqual(bundles(released));
      expect(
        getFieldSymbolSources({
          state: sanitizeStateForViewer(released, "alice"),
          actingPlayerId: "bob",
          getCardDefinitionById: engine.getCardDefinitionById,
        }).find((source) => source.sourceInstanceId === "hidden-slot")
      ).toBeUndefined();
      const withGreen = executeSymbolAdd(
        a,
        "bob",
        {
          target: { player: "self", category: ["spirit"], count: 1 },
          symbol: "green",
          duration: { scope: "turn" },
        },
        "public-source",
        engine.getCardDefinitionById,
        ["hidden-slot"]
      );
      expect(
        bundles(withGreen).map((bundle) => ({
          ...bundle,
          colors: [...bundle.colors].sort(),
        }))
      ).toEqual([
        { colors: ["red"], count: 1 },
        { colors: ["blue", "green", "red"], count: 1 },
      ]);
      expect(bundles(withGreen, "bob")).toEqual(bundles(withGreen));
      expect(sourceFeatures(withGreen)).not.toEqual(sourceFeatures(a));
      expect(projectAiSearchCards(observe(withGreen))[0]).not.toEqual(
        projectAiSearchCards(observe(a))[0]
      );
    }
  );

  it.each([false, true])(
    "symbol-dependent immunity and global symbol/BP grants do not re-enter (compound=%s)",
    (compound) => {
      const publicDefinition: CardDefinition = compound
        ? {
            ...source,
            symbolColors: ["red", "blue"],
            symbolColorEntries: [["red", "blue"]],
          }
        : source;
      const localEngine: Engine = {
        ...engine,
        getCardDefinitionById: (id) =>
          id === source.cardNo
            ? publicDefinition
            : engine.getCardDefinitionById(id),
      };
      const build = (secret: CardDefinition) => {
        const immune = executeEffectImmunity(
          fixture(secret, 7000, compound),
          "bob",
          {
            target: {
              player: "self",
              count: -1,
              filter: { category: ["spirit"], zone: ["field"], symbolCount: 1 },
            },
            duration: { scope: "turn" },
            sourcePlayerScope: "self",
          },
          "public-source",
          localEngine.getCardDefinitionById
        );
        const symbols = executeSymbolAdd(
          immune,
          "bob",
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
          "public-source",
          localEngine.getCardDefinitionById
        );
        return executeBpModify(
          symbols,
          "bob",
          {
            target: { player: "self", category: ["spirit"], count: -1 },
            amount: 1000,
            duration: { scope: "turn" },
          },
          "public-source",
          localEngine.getCardDefinitionById
        );
      };
      const observation = (state: GameState, viewer = "alice") =>
        buildAiObservation({
          state,
          viewpointPlayerId: viewer,
          getCardDefinitionById: localEngine.getCardDefinitionById,
        });
      const a = build(secretA);
      const b = build(secretB);
      const expected = compound ? 3000 : 7000;
      expect(observation(a).cards[1]?.effectiveBp).toBe(expected);
      expect(observation(a, "bob").cards[1]?.effectiveBp).toBe(expected);
      expect(observation(a).cards[1]?.effectiveSymbolBundles).toEqual([
        { colors: compound ? ["red", "blue"] : ["red"], count: 1 },
      ]);
      expect(observation(a)).toEqual(observation(b));
      expect(
        buildPolicyValueInferenceInput({ state: a, node, engine: localEngine })
      ).toEqual(
        buildPolicyValueInferenceInput({ state: b, node, engine: localEngine })
      );
      const released = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "defense_immune"
        ),
      };
      // A live copy also follows the source's own +1000 and added symbol.
      expect(observation(released).cards[1]?.effectiveBp).toBe(
        compound ? 5000 : 8000
      );
      expect(
        observation(released).cards[1]?.effectiveSymbolBundles.reduce(
          (sum, bundle) => sum + bundle.count,
          0
        )
      ).toBe(compound ? 3 : 2);
    }
  );
});

describe("public grant modifier gates and relative levels", () => {
  const withAliceSource = (state: GameState): GameState => ({
    ...state,
    cardInstances: [
      ...state.cardInstances,
      createCardInstance(source, {
        instanceId: "alice-source",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
      }),
    ],
  });
  const addSymbols = (
    state: GameState,
    actingPlayerId = "bob",
    preventionLevel?: Parameters<typeof executeSymbolAdd>[8],
    bypass?: Parameters<typeof executeSymbolAdd>[9]
  ) => {
    const player = actingPlayerId === "bob" ? "self" : "opponent";
    const result = executeSymbolAdd(
      state,
      actingPlayerId,
      {
        target: { player, category: ["spirit"], count: -1 },
        symbol: "blue",
        duration: { scope: "turn" },
        continuousTarget: {
          kind: "filter",
          player,
          zone: "field",
          count: "all",
          filter: { category: ["spirit"] },
        },
      },
      actingPlayerId === "bob" ? "public-source" : "alice-source",
      engine.getCardDefinitionById,
      undefined,
      undefined,
      undefined,
      preventionLevel,
      bypass
    );
    const ce = result.activeContinuousEffects.find(
      (effect) => effect.modifierTag === "symbol_addition"
    )!;
    expect(ce.actingPlayerId).toBe(actingPlayerId);
    expect(ce.targetFilter?.player).toBe(player);
    return result;
  };
  const cardFeatures = (state: GameState) => {
    const input = buildPolicyValueInferenceInput({ state, node, engine });
    const slot = input.observation.cardInstanceIds.indexOf("hidden-slot");
    expect(slot).toBeGreaterThanOrEqual(0);
    return input.observation.cards[slot]!.features;
  };
  const assertSymbols = (a: GameState, b: GameState, added: boolean) => {
    const expected = added ? ["red", "blue"] : ["red"];
    expect(hiddenToken(a).effectiveSymbols).toEqual(expected);
    expect(hiddenToken(a, "bob").effectiveSymbols).toEqual(expected);
    expect(observe(a)).toEqual(observe(b));
    expect(projectAiSearchCards(observe(a))[1]?.effectiveSymbolBundles).toEqual(
      hiddenToken(a).effectiveSymbolBundles
    );
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
    const withoutAddition = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "symbol_addition"
      ),
    };
    if (added)
      expect(cardFeatures(a)).not.toEqual(cardFeatures(withoutAddition));
    else expect(cardFeatures(a)).toEqual(cardFeatures(withoutAddition));
    const masked = sanitizeStateForViewer(a, "alice");
    expect(
      getFieldSymbolSources({
        state: masked,
        actingPlayerId: "bob",
        getCardDefinitionById: engine.getCardDefinitionById,
      }).find((entry) => entry.sourceInstanceId === "hidden-slot")
        ?.symbolEntries
    ).toHaveLength(expected.length);
  };

  for (const mode of ["global", "snapshot"] as const) {
    for (const amount of [1000, -1000]) {
      it.each(["bp", "symbols"] as const)(
        `native ${mode} BP ${amount} respects %s-only immunity`,
        (aspect) => {
          const build = (secret: CardDefinition, protectedTarget = true) => {
            let state = withAliceSource(fixture(secret));
            if (protectedTarget)
              state = executeEffectImmunity(
                state,
                "alice",
                {
                  target: {
                    player: "opponent",
                    count: -1,
                    filter: { category: ["spirit"], zone: ["field"] },
                  },
                  duration: { scope: "turn" },
                  sourceScope: {
                    restrictedAspects: [aspect],
                    excludeSelf: true,
                  },
                  sourcePlayerScope: "any",
                },
                "alice-source",
                engine.getCardDefinitionById
              );
            return executeEffect({
              chainId: `public-grant-bp:${mode}:${amount}:${aspect}`,
              state,
              effect: {
                timing:
                  mode === "global"
                    ? { kind: "continuous" }
                    : { kind: "activated", mode: "flash" },
                steps: [
                  {
                    action: {
                      kind: "bp_modify",
                      target: {
                        kind: "filter",
                        player: "self",
                        ...(mode === "snapshot" ? { zone: "field" } : {}),
                        count: "all",
                        filter: { category: ["spirit"] },
                      },
                      amount,
                      duration: {
                        scope: mode === "global" ? "while_on_field" : "turn",
                      },
                    },
                  },
                ],
              },
              sourceInstanceId: "public-source",
              actingPlayerId: "bob",
              getCardDefinitionById: engine.getCardDefinitionById,
            });
          };
          const a = build(secretA);
          const bpEffects = a.activeContinuousEffects.filter(
            (ce) => ce.modifierTag === "bp_modifier"
          );
          if (mode === "global") {
            expect(bpEffects).toHaveLength(1);
            expect(bpEffects[0]?.targetFilter).toMatchObject({
              category: ["spirit"],
            });
            expect(bpEffects[0]?.targetInstanceId).toBeUndefined();
          } else
            expect(
              bpEffects.some((ce) => ce.targetInstanceId === "hidden-slot")
            ).toBe(aspect !== "bp");
          const expected = 7000 + (aspect === "bp" ? 0 : amount);
          expect(hiddenToken(a).effectiveBp).toBe(expected);
          expect(hiddenToken(a, "bob").effectiveBp).toBe(expected);
          expect(observe(a)).toEqual(observe(build(secretB)));
          expect(projectAiSearchCards(observe(a))[1]?.effectiveBp).toBe(
            expected
          );
          const input = buildPolicyValueInferenceInput({
            state: a,
            node,
            engine,
          });
          expect(input).toEqual(
            buildPolicyValueInferenceInput({
              state: build(secretB),
              node,
              engine,
            })
          );
          const unprotected = build(secretA, false);
          expect(hiddenToken(unprotected).effectiveBp).toBe(7000 + amount);
          if (aspect === "bp")
            expect(cardFeatures(a)).not.toEqual(cardFeatures(unprotected));
        }
      );
    }

    it.each(["symbols", "bp"] as const)(
      `native ${mode} symbols respect %s-only immunity`,
      (aspect) => {
        const build = (secret: CardDefinition) =>
          executeEffect({
            chainId: `public-grant-symbols:${mode}:${aspect}`,
            state: executeEffectImmunity(
              withAliceSource(fixture(secret)),
              "alice",
              {
                target: {
                  player: "opponent",
                  count: -1,
                  filter: { category: ["spirit"], zone: ["field"] },
                },
                duration: { scope: "turn" },
                sourceScope: { restrictedAspects: [aspect], excludeSelf: true },
                sourcePlayerScope: "any",
              },
              "alice-source",
              engine.getCardDefinitionById
            ),
            effect: {
              timing:
                mode === "global"
                  ? { kind: "continuous" }
                  : { kind: "activated", mode: "flash" },
              steps: [
                {
                  action: {
                    kind: "symbol_add",
                    target: {
                      kind: "filter",
                      player: "self",
                      zone: "field",
                      count: "all",
                      filter: { category: ["spirit"] },
                    },
                    symbol: "blue",
                    duration: {
                      scope: mode === "global" ? "while_on_field" : "turn",
                    },
                  },
                },
              ],
            },
            sourceInstanceId: "public-source",
            actingPlayerId: "bob",
            getCardDefinitionById: engine.getCardDefinitionById,
          });
        const a = build(secretA);
        const effects = a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag === "symbol_addition"
        );
        if (mode === "global") {
          expect(effects).toHaveLength(1);
          expect(effects[0]?.targetFilter).toBeDefined();
        } else
          expect(
            effects.some((ce) => ce.targetInstanceId === "hidden-slot")
          ).toBe(aspect !== "symbols");
        assertSymbols(a, build(secretB), aspect !== "symbols");
      }
    );

    it.each([
      { kind: "none", added: false },
      { kind: "blanket_affect_immunity", added: true },
      { kind: "all_effects", added: true },
    ] as const)(
      `native ${mode} symbols preserve $kind against qa-020 immunity`,
      ({ kind, added }) => {
        const build = (secret: CardDefinition) =>
          executeEffect({
            chainId: `public-grant-symbol-qa:${mode}:${kind}`,
            state: executeEffectImmunity(
              withAliceSource(fixture(secret)),
              "bob",
              {
                target: { player: "self", category: ["spirit"], count: -1 },
                duration: { scope: "turn" },
                sourcePlayerScope: "opponent",
                satisfiesPreventionRestriction: true,
              },
              "public-source",
              engine.getCardDefinitionById
            ),
            effect: {
              timing:
                mode === "global"
                  ? { kind: "continuous" }
                  : { kind: "activated", mode: "flash" },
              preventionLevel: "unpreventable",
              targetLockBypass: { kind },
              steps: [
                {
                  action: {
                    kind: "symbol_add",
                    target: {
                      kind: "filter",
                      player: "opponent",
                      zone: "field",
                      count: "all",
                      filter: { category: ["spirit"] },
                    },
                    symbol: "blue",
                    duration: {
                      scope: mode === "global" ? "while_on_field" : "turn",
                    },
                  },
                },
              ],
            },
            sourceInstanceId: "alice-source",
            actingPlayerId: "alice",
            getCardDefinitionById: engine.getCardDefinitionById,
          });
        assertSymbols(build(secretA), build(secretB), added);
      }
    );
  }

  it.each([
    {
      name: "ordinary cannot_include",
      level: "none",
      bypass: { kind: "none" },
      added: false,
    },
    {
      name: "bare unpreventable cannot_include",
      level: "unpreventable",
      bypass: { kind: "none" },
      added: false,
    },
    {
      name: "affect-only bypass cannot_include",
      level: "unpreventable",
      bypass: { kind: "blanket_affect_immunity" },
      added: false,
    },
    {
      name: "all-effects bypass cannot_include",
      level: "unpreventable",
      bypass: { kind: "all_effects" },
      added: true,
    },
  ] as const)("global symbols respect $name", ({ level, bypass, added }) => {
    const build = (secret: CardDefinition) =>
      addSymbols(
        executeEffectResistance(
          fixture(secret),
          "bob",
          {
            kind: "effect_resistance",
            target: { player: "self", category: ["spirit"], count: -1 },
            duration: { scope: "turn" },
            resistType: "cannot_include",
            source: "all",
          },
          "public-source",
          engine.getCardDefinitionById
        ),
        "bob",
        level,
        bypass
      );
    const a = build(secretA);
    expect(
      a.activeContinuousEffects.some(
        (ce) =>
          ce.modifierTag === "cannot_include" && ce.targetFilter !== undefined
      )
    ).toBe(true);
    assertSymbols(a, build(secretB), added);
    const released = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "cannot_include"
      ),
    };
    expect(hiddenToken(released).effectiveSymbols).toEqual(["red", "blue"]);
  });

  it.each(["symbols", "bp"] as const)(
    "global symbols use the %s immunity aspect",
    (aspect) => {
      const build = (secret: CardDefinition) =>
        addSymbols(
          executeEffectImmunity(
            withAliceSource(fixture(secret)),
            "alice",
            {
              target: {
                player: "opponent",
                count: -1,
                filter: { category: ["spirit"], zone: ["field"] },
              },
              duration: { scope: "turn" },
              sourceScope: { restrictedAspects: [aspect], excludeSelf: true },
              sourcePlayerScope: "any",
            },
            "alice-source",
            engine.getCardDefinitionById
          )
        );
      const a = build(secretA);
      expect(
        a.activeContinuousEffects.find(
          (ce) => ce.modifierTag === "defense_immune"
        )?.immunitySourceScope
      ).toMatchObject({ restrictedAspects: [aspect], excludeSelf: true });
      assertSymbols(a, build(secretB), aspect !== "symbols");
      const released = {
        ...a,
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "defense_immune"
        ),
      };
      expect(hiddenToken(released).effectiveSymbols).toEqual(["red", "blue"]);
    }
  );

  it.each([
    { name: "bare unpreventable", bypass: { kind: "none" }, added: false },
    {
      name: "blanket affect bypass",
      bypass: { kind: "blanket_affect_immunity" },
      added: true,
    },
    {
      name: "all-effects bypass",
      bypass: { kind: "all_effects" },
      added: true,
    },
  ] as const)(
    "global symbols preserve $name against qa-020 immunity",
    ({ bypass, added }) => {
      const build = (secret: CardDefinition) =>
        addSymbols(
          executeEffectImmunity(
            withAliceSource(fixture(secret)),
            "bob",
            {
              target: { player: "self", category: ["spirit"], count: -1 },
              duration: { scope: "turn" },
              sourcePlayerScope: "opponent",
              satisfiesPreventionRestriction: true,
            },
            "public-source",
            engine.getCardDefinitionById
          ),
          "alice",
          "unpreventable",
          bypass
        );
      const a = build(secretA);
      assertSymbols(a, build(secretB), added);
      if (bypass.kind !== "none") {
        expect(
          a.activeContinuousEffects.find(
            (ce) => ce.modifierTag === "symbol_addition"
          )?.metadata?.symbolAddSourceTargetLockBypass
        ).toEqual(bypass);
      }
    }
  );

  it.each([
    {
      name: "maximum true",
      filter: { atOwnMaximumLevel: true },
      sourceBp: 4000,
      hiddenBp: 7000,
    },
    {
      name: "maximum false",
      filter: { atOwnMaximumLevel: false },
      sourceBp: 3000,
      hiddenBp: 8000,
    },
    {
      name: "maximum OR snapshot",
      filter: {
        filterOr: [
          { category: ["spirit"], atOwnMaximumLevel: true },
          { cardName: { exact: "absent" } },
        ],
      },
      sourceBp: 4000,
      hiddenBp: 7000,
    },
    {
      name: "maximum exclusion",
      filter: { exclude: { atOwnMaximumLevel: true } },
      sourceBp: 3000,
      hiddenBp: 8000,
    },
    {
      name: "maximum with printed BP",
      filter: { atOwnMaximumLevel: true, minBp: 1000, bpBasis: "printed" },
      sourceBp: 4000,
      hiddenBp: 8000,
    },
  ] satisfies {
    name: string;
    filter: CardFilter;
    sourceBp: number;
    hiddenBp: number;
  }[])("relative Lv immunity uses $name", ({ filter, sourceBp, hiddenBp }) => {
    const build = (secret: CardDefinition) =>
      executeBpModify(
        executeEffectImmunity(
          fixture(secret),
          "bob",
          {
            target: {
              player: "self",
              count: -1,
              filter: { category: ["spirit"], zone: ["field"], ...filter },
            },
            duration: { scope: "turn" },
            sourcePlayerScope: "self",
          },
          "public-source",
          engine.getCardDefinitionById
        ),
        "bob",
        {
          target: { player: "self", category: ["spirit"], count: -1 },
          amount: 1000,
          duration: { scope: "turn" },
        },
        "public-source",
        engine.getCardDefinitionById
      );
    const a = build(secretA),
      b = build(secretB);
    for (const viewer of ["alice", "bob"]) {
      expect(hiddenToken(a, viewer).effectiveBp).toBe(hiddenBp);
      expect(
        observe(a, viewer).cards.find(
          (card) => card.instanceId === "public-source"
        )?.effectiveBp
      ).toBe(sourceBp);
    }
    expect(observe(a)).toEqual(observe(b));
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
    const slot = buildPolicyValueInferenceInput({
      state: a,
      node,
      engine,
    }).observation.cardInstanceIds.indexOf("hidden-slot");
    expect(
      buildPolicyValueInferenceInput({ state: a, node, engine }).observation
        .cards[slot]?.features[37]
    ).toBe(hiddenBp / 20000);
    const released = {
      ...a,
      activeContinuousEffects: a.activeContinuousEffects.filter(
        (ce) => ce.modifierTag !== "defense_immune"
      ),
    };
    expect(hiddenToken(released).effectiveBp).toBe(8000);
    expect(
      observe(released).cards.find(
        (card) => card.instanceId === "public-source"
      )?.effectiveBp
    ).toBe(4000);
  });

  it("global symbols distinguish explicit-target locks from include_all locks", () => {
    const build = (secret: CardDefinition) =>
      addSymbols(
        executeEffectResistance(
          fixture(secret),
          "bob",
          {
            kind: "effect_resistance",
            target: { player: "self", category: ["spirit"], count: -1 },
            duration: { scope: "turn" },
            resistType: "cannot_be_targeted",
            source: "all",
          },
          "public-source",
          engine.getCardDefinitionById
        )
      );
    assertSymbols(build(secretA), build(secretB), true);
  });

  it("relative maximum follows the public live level table and grant removal", () => {
    const build = (secret: CardDefinition) =>
      executeEffectImmunity(
        fixture(secret, 7000, true),
        "bob",
        {
          target: {
            player: "self",
            count: -1,
            filter: {
              category: ["spirit"],
              zone: ["field"],
              atOwnMaximumLevel: true,
            },
          },
          duration: { scope: "turn" },
          sourcePlayerScope: "self",
        },
        "public-source",
        engine.getCardDefinitionById
      );
    const matches = (state: GameState, viewer: string) => {
      const masked = sanitizeStateForViewer(state, viewer);
      const card = masked.cardInstances.find(
        (c) => c.instanceId === "hidden-slot"
      )!;
      const ce = masked.activeContinuousEffects.find(
        (effect) => effect.modifierTag === "defense_immune"
      )!;
      expect(ce.targetFilter?.atOwnMaximumLevel).toBe(true);
      return matchesGlobalCETargetFilter(
        masked,
        ce,
        card,
        engine.getCardDefinitionById,
        1
      );
    };
    const raise = (state: GameState): GameState => ({
      ...state,
      cardInstances: state.cardInstances.map((card) =>
        card.instanceId === "public-source"
          ? { ...card, normalCoreCount: 3 }
          : card
      ),
    });
    const a = build(secretA),
      b = build(secretB);
    for (const viewer of ["alice", "bob"]) {
      expect(hiddenToken(a, viewer).effectiveLevel).toBe(1);
      expect(matches(a, viewer)).toBe(false);
      expect(hiddenToken(raise(a), viewer).effectiveLevel).toBe(2);
      expect(matches(raise(a), viewer)).toBe(true);
      const released = {
        ...raise(a),
        activeContinuousEffects: a.activeContinuousEffects.filter(
          (ce) => ce.modifierTag !== "act_as_spirit"
        ),
      };
      expect(matches(released, viewer)).toBe(false);
    }
    expect(observe(raise(a))).toEqual(observe(raise(b)));
    expect(
      buildPolicyValueInferenceInput({ state: raise(a), node, engine })
    ).toEqual(
      buildPolicyValueInferenceInput({ state: raise(b), node, engine })
    );
  });

  it("relative minimum uses the public table override with a live Lv", () => {
    const build = (secret: CardDefinition) => {
      // One real public grant: current Lv follows the source (Lv1), while
      // the explicitly granted table starts at Lv2. No printed table is used.
      const granted = fixture(
        secret,
        7000,
        true,
        undefined,
        ["red"],
        [{ level: 2, requiredCores: 1, bp: 7000 }]
      );
      expect(
        granted.activeContinuousEffects.filter(
          (ce) => ce.modifierTag === "act_as_spirit"
        )
      ).toHaveLength(1);
      expect(hiddenToken(granted).effectiveLevel).toBe(1);
      return executeEffectImmunity(
        granted,
        "bob",
        {
          target: {
            player: "self",
            count: -1,
            filter: {
              category: ["spirit"],
              zone: ["field"],
              belowOwnMinimumLevel: true,
            },
          },
          duration: { scope: "turn" },
          sourcePlayerScope: "self",
        },
        "public-source",
        engine.getCardDefinitionById
      );
    };
    const a = build(secretA),
      b = build(secretB);
    for (const viewer of ["alice", "bob"]) {
      const masked = sanitizeStateForViewer(a, viewer);
      const ce = masked.activeContinuousEffects.find(
        (effect) => effect.modifierTag === "defense_immune"
      )!;
      expect(
        matchesGlobalCETargetFilter(
          masked,
          ce,
          masked.cardInstances.find(
            (card) => card.instanceId === "hidden-slot"
          )!,
          engine.getCardDefinitionById,
          1
        )
      ).toBe(true);
      expect(
        matchesGlobalCETargetFilter(
          masked,
          ce,
          masked.cardInstances.find(
            (card) => card.instanceId === "public-source"
          )!,
          engine.getCardDefinitionById,
          1
        )
      ).toBe(false);
    }
    expect(observe(a)).toEqual(observe(b));
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
  });

  it.each([true, false])("global BP uses relative maximum %s", (maximum) => {
    const build = (secret: CardDefinition) =>
      executeBpModify(
        fixture(secret),
        "bob",
        {
          target: {
            player: "self",
            count: -1,
            filter: {
              category: ["spirit"],
              zone: ["field"],
              atOwnMaximumLevel: maximum,
            },
          },
          amount: 1000,
          duration: { scope: "turn" },
        },
        "public-source",
        engine.getCardDefinitionById
      );
    const a = build(secretA),
      b = build(secretB);
    for (const viewer of ["alice", "bob"]) {
      expect(hiddenToken(a, viewer).effectiveBp).toBe(maximum ? 8000 : 7000);
      expect(
        observe(a, viewer).cards.find(
          (card) => card.instanceId === "public-source"
        )?.effectiveBp
      ).toBe(maximum ? 3000 : 4000);
    }
    expect(observe(a)).toEqual(observe(b));
    expect(buildPolicyValueInferenceInput({ state: a, node, engine })).toEqual(
      buildPolicyValueInferenceInput({ state: b, node, engine })
    );
  });
});

describe("self target native modifiers respect scoped immunity", () => {
  for (const operation of ["bp_modify", "symbol_add"] as const)
    for (const aspect of ["bp", "symbols"] as const)
      for (const scope of ["self", "any", "opponent"] as const)
        it.each(["self", "filter"] as const)(
          `${operation} via %s respects ${scope}/${aspect} immunity`,
          (targetKind) => {
            const target: TargetSpec =
              targetKind === "self"
                ? { kind: "self" }
                : {
                    kind: "filter",
                    player: "self",
                    zone: "field",
                    count: "all",
                    filter: {
                      category: ["spirit"],
                      cardName: { exact: "Public own host" },
                    },
                  };
            const effect: Effect = {
              timing: { kind: "activated", mode: "flash" },
              textRef: [0, 1],
              steps: [
                {
                  action:
                    operation === "bp_modify"
                      ? {
                          kind: "bp_modify",
                          target,
                          amount: 1000,
                          duration: { scope: "turn" },
                        }
                      : {
                          kind: "symbol_add",
                          target,
                          symbol: "blue",
                          duration: { scope: "turn" },
                        },
                },
              ],
            };
            const hostDef: CardDefinition = {
              ...source,
              cardNo: "AI-OWN-HOST",
              name: "Public own host",
              underCardSlots: [{ roleTag: "バレットエディット", maxCount: 1 }],
            };
            const providerDef: CardDefinition = {
              ...source,
              cardNo: "AI-OWN-PROVIDER",
              name: "Public own provider",
              colors: ["blue"],
              symbolColors: ["blue"],
              effects: [effect],
              textLines: [
                "（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
                operation === "bp_modify"
                  ? "このスピリットをBP+1000する。"
                  : "このスピリットに青のシンボル1つを追加する。",
              ],
            };
            const localEngine: Engine = {
              ...engine,
              cards: [...definitions, hostDef, providerDef],
              getCardDefinitionById: (id) =>
                [hostDef, providerDef, ...definitions].find(
                  (d) => d.cardNo === id
                ),
            };
            const build = (secret: CardDefinition, protectedTarget = true) => {
              const host = createCardInstance(hostDef, {
                instanceId: "own-host",
                ownerPlayerId: "alice",
                zone: "field",
                cores: 1,
              });
              const provider = createCardInstance(providerDef, {
                instanceId: "own-provider",
                ownerPlayerId: "alice",
                zone: "field",
                cores: 0,
                attachedToInstanceId: host.instanceId,
              });
              host.underCards = [
                {
                  cardInstanceId: provider.instanceId,
                  role: "text_role",
                  roleTag: "バレットエディット",
                },
              ];
              let state = fixture(secret);
              state = {
                ...state,
                cardInstances: [...state.cardInstances, host, provider],
              };
              const qualification = {
                state,
                hostCard: host,
                hostDefinition: hostDef,
                effectSourceInstanceId: provider.instanceId,
                effectSourceDefinitionId: providerDef.cardNo,
              };
              expect(isActiveTextRoleUnderEffectSource(qualification)).toBe(
                true
              );
              expect(
                isActiveTextRoleUnderEffectSource({
                  ...qualification,
                  hostDefinition: { ...hostDef, underCardSlots: [] },
                })
              ).toBe(false);
              expect(
                resolveAffectSourceIdentity({
                  state,
                  sourceInstanceId: host.instanceId,
                  effectSourceInstanceId: provider.instanceId,
                  effectSourceDefinitionId: providerDef.cardNo,
                  getCardDefinitionById: localEngine.getCardDefinitionById,
                })
              ).toMatchObject({
                instanceId: provider.instanceId,
                definition: { colors: ["blue"] },
                effectSourceIsCombinedBrave: false,
              });
              if (protectedTarget) {
                state = executeEffect({
                  chainId: "own-host-immunity",
                  state,
                  effect: {
                    timing: { kind: "activated", mode: "flash" },
                    steps: [
                      {
                        action: {
                          kind: "effect_immunity",
                          target: {
                            kind: "filter",
                            player: "opponent",
                            zone: "field",
                            count: "all",
                            filter: {
                              category: ["spirit"],
                              cardName: { exact: hostDef.name },
                            },
                          },
                          sourceScope: {
                            colors: ["blue"],
                            restrictedAspects: [aspect],
                          },
                          sourcePlayerScope: scope,
                          duration: { scope: "turn" },
                        },
                      },
                    ],
                  },
                  sourceInstanceId: "public-source",
                  actingPlayerId: "bob",
                  getCardDefinitionById: localEngine.getCardDefinitionById,
                });
                expect(
                  state.activeContinuousEffects.find(
                    (ce) => ce.modifierTag === "defense_immune"
                  )
                ).toMatchObject({
                  targetFilter: { cardName: { exact: hostDef.name } },
                  immunityPlayerScope: scope,
                  immunitySourceScope: {
                    colors: ["blue"],
                    restrictedAspects: [aspect],
                  },
                });
              }
              expect(
                getCandidateTargetInstanceIds(
                  state,
                  "alice",
                  {
                    candidateTargetZones: ["field"],
                    candidateTargetPlayerScope: "acting_player",
                    targetCardFilter: { cardName: { exact: hostDef.name } },
                    targetEffectAspect:
                      operation === "bp_modify" ? "bp" : "symbols",
                  },
                  {
                    sourceInstanceId: host.instanceId,
                    getCardDefinitionById: localEngine.getCardDefinitionById,
                    affectSourceIdentity: resolveAffectSourceIdentity({
                      state,
                      sourceInstanceId: host.instanceId,
                      effectSourceInstanceId: provider.instanceId,
                      effectSourceDefinitionId: providerDef.cardNo,
                      getCardDefinitionById: localEngine.getCardDefinitionById,
                    }),
                  }
                )
              ).toEqual(protectedTarget && blocked ? [] : [host.instanceId]);
              return executeEffect({
                chainId: `own-host:${operation}:${aspect}:${scope}:${targetKind}`,
                state,
                effect,
                sourceInstanceId: host.instanceId,
                effectSourceInstanceId: provider.instanceId,
                effectSourceDefinitionId: providerDef.cardNo,
                actingPlayerId: "alice",
                getCardDefinitionById: localEngine.getCardDefinitionById,
              });
            };
            const blocked =
              scope !== "opponent" &&
              aspect === (operation === "bp_modify" ? "bp" : "symbols");
            const a = build(secretA),
              b = build(secretB);
            const observation = (state: GameState, viewer = "alice") =>
              buildAiObservation({
                state,
                viewpointPlayerId: viewer,
                getCardDefinitionById: localEngine.getCardDefinitionById,
              });
            for (const viewer of ["alice", "bob"]) {
              const card = observation(a, viewer).cards.find(
                (c) => c.instanceId === "own-host"
              );
              expect(card?.effectiveBp).toBe(
                operation === "bp_modify" && !blocked ? 4000 : 3000
              );
              expect(card?.effectiveSymbols).toEqual(
                operation === "symbol_add" && !blocked
                  ? ["red", "blue"]
                  : ["red"]
              );
            }
            const tag =
              operation === "bp_modify" ? "bp_modifier" : "symbol_addition";
            const modifiers = a.activeContinuousEffects.filter(
              (ce) => ce.modifierTag === tag
            );
            expect(modifiers).toHaveLength(blocked ? 0 : 1);
            if (!blocked)
              expect(modifiers[0]).toMatchObject({
                targetInstanceId: "own-host",
                provenance: {
                  effectSourceInstanceId: "own-provider",
                  effectSourceDefinitionId: providerDef.cardNo,
                },
              });
            expect(observation(a)).toEqual(observation(b));
            expect(projectAiSearchCards(observation(a))).toEqual(
              projectAiSearchCards(observation(b))
            );
            const input = (state: GameState) =>
              buildPolicyValueInferenceInput({
                state,
                node,
                engine: localEngine,
              });
            const inputA = input(a),
              inputB = input(b);
            expect(inputA).toEqual(inputB);
            const nn = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
            expect(nn.predict(inputA)).toEqual(nn.predict(inputB));
            const withoutModifier = {
              ...a,
              activeContinuousEffects: a.activeContinuousEffects.filter(
                (ce) =>
                  ce.modifierTag !== tag || ce.targetInstanceId !== "own-host"
              ),
            };
            const features = (state: GameState) => {
              const x = input(state);
              const slot = x.observation.cardInstanceIds.indexOf("own-host");
              expect(slot).toBeGreaterThanOrEqual(0);
              return x.observation.cards[slot]!.features;
            };
            if (blocked) expect(features(a)).toEqual(features(withoutModifier));
            else expect(features(a)).not.toEqual(features(withoutModifier));
            const unprotected = observation(build(secretA, false)).cards.find(
              (c) => c.instanceId === "own-host"
            );
            expect(unprotected?.effectiveBp).toBe(
              operation === "bp_modify" ? 4000 : 3000
            );
            expect(unprotected?.effectiveSymbols).toEqual(
              operation === "symbol_add" ? ["red", "blue"] : ["red"]
            );
          }
        );
});

describe("native symbol grants from a declared text-role provider", () => {
  const build = (
    secret: CardDefinition,
    providerColor: "blue" | "red",
    mode: "global" | "snapshot",
    gate: "immunity" | "restriction",
    protectedTarget = true
  ) => {
    const effect: Effect = {
      timing:
        mode === "global"
          ? { kind: "continuous" }
          : { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "symbol_add",
            target: {
              kind: "filter",
              player: gate === "immunity" ? "opponent" : "self",
              zone: "field",
              count: "all",
              filter: { category: ["spirit"] },
            },
            symbol: "blue",
            duration: {
              scope: mode === "global" ? "while_on_field" : "turn",
            },
          },
        },
      ],
      textRef: [0, 1],
    };
    const hostDef: CardDefinition = {
      ...source,
      cardNo: "AI-PROVIDER-HOST",
      colors: [providerColor === "blue" ? "red" : "blue"],
      underCardSlots: [{ roleTag: "バレットエディット", maxCount: 1 }],
    };
    const providerDef: CardDefinition = {
      ...source,
      cardNo: "AI-TEXT-PROVIDER",
      colors: [providerColor],
      textLines: [
        "（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
        "対象に青のシンボル1つを追加する。",
      ],
      effects: [effect],
    };
    const localEngine: Engine = {
      ...engine,
      cards: [...definitions, hostDef, providerDef],
      getCardDefinitionById: (id) =>
        [hostDef, providerDef, ...definitions].find((def) => def.cardNo === id),
    };
    const host = createCardInstance(hostDef, {
      instanceId: "provider-host",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const provider = createCardInstance(providerDef, {
      instanceId: "text-provider",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      attachedToInstanceId: host.instanceId,
    });
    host.underCards = [
      {
        cardInstanceId: provider.instanceId,
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
    let state = fixture(secret);
    state = {
      ...state,
      cardInstances: [...state.cardInstances, host, provider],
    };
    const qualifications = {
      state,
      hostCard: host,
      hostDefinition: hostDef,
      effectSourceInstanceId: provider.instanceId,
      effectSourceDefinitionId: providerDef.cardNo,
    };
    expect(isActiveTextRoleUnderEffectSource(qualifications)).toBe(true);
    expect(
      isActiveTextRoleUnderEffectSource({
        ...qualifications,
        hostDefinition: { ...hostDef, underCardSlots: [] },
      })
    ).toBe(false);
    expect(
      resolveAffectSourceIdentity({
        state,
        sourceInstanceId: host.instanceId,
        effectSourceInstanceId: provider.instanceId,
        effectSourceDefinitionId: providerDef.cardNo,
        getCardDefinitionById: localEngine.getCardDefinitionById,
      })
    ).toMatchObject({
      instanceId: provider.instanceId,
      definitionId: providerDef.cardNo,
      definition: { colors: [providerColor] },
      usedEffectSource: true,
      effectSourceIsCombinedBrave: false,
    });
    if (protectedTarget)
      state =
        gate === "immunity"
          ? executeEffectImmunity(
              state,
              "bob",
              {
                target: { player: "self", category: ["spirit"], count: -1 },
                sourceScope: { colors: ["red"] },
                sourcePlayerScope: "opponent",
                duration: { scope: "turn" },
              },
              "public-source",
              localEngine.getCardDefinitionById
            )
          : executeRestrictSymbolAddition(
              state,
              "bob",
              {
                kind: "restrict_symbol_addition",
                player: "opponent",
                maxTotal: 0,
                sourceFilter: { colors: ["red"] },
                duration: { scope: "turn" },
              },
              "public-source"
            );
    state = executeEffect({
      chainId: `public-grant-provider:${mode}:${gate}:${providerColor}`,
      state,
      effect,
      sourceInstanceId: host.instanceId,
      effectSourceInstanceId: provider.instanceId,
      effectSourceDefinitionId: providerDef.cardNo,
      actingPlayerId: "alice",
      getCardDefinitionById: localEngine.getCardDefinitionById,
    });
    return { state, engine: localEngine };
  };

  for (const mode of ["global", "snapshot"] as const) {
    for (const gate of ["immunity", "restriction"] as const) {
      it.each(["blue", "red"] as const)(
        `${mode} ${gate} uses the %s provider rather than the opposite-color host`,
        (color) => {
          const a = build(secretA, color, mode, gate);
          const b = build(secretB, color, mode, gate);
          const targetId =
            gate === "immunity" ? "hidden-slot" : "provider-host";
          const expected = color === "blue" ? ["red", "blue"] : ["red"];
          const observation = (result: typeof a, viewer = "alice") =>
            buildAiObservation({
              state: result.state,
              viewpointPlayerId: viewer,
              getCardDefinitionById: result.engine.getCardDefinitionById,
            });
          for (const viewer of ["alice", "bob"])
            expect(
              observation(a, viewer).cards.find(
                (c) => c.instanceId === targetId
              )?.effectiveSymbols
            ).toEqual(expected);
          expect(observation(a)).toEqual(observation(b));
          expect(projectAiSearchCards(observation(a))).toEqual(
            projectAiSearchCards(observation(b))
          );
          const input = (result: typeof a) =>
            buildPolicyValueInferenceInput({
              state: result.state,
              node,
              engine: result.engine,
            });
          expect(input(a)).toEqual(input(b));
          const nn = createTinyPolicyValueNetwork({ seed: 31, hiddenDim: 8 });
          expect(nn.predict(input(a))).toEqual(nn.predict(input(b)));
          const additions = a.state.activeContinuousEffects.filter(
            (ce) => ce.modifierTag === "symbol_addition"
          );
          if (color === "blue") {
            expect(additions.length).toBeGreaterThan(0);
            expect(additions[0]?.provenance?.effectSourceInstanceId).toBe(
              "text-provider"
            );
            if (mode === "global")
              expect(additions[0]?.targetFilter).toBeDefined();
            else
              expect(
                additions.some((ce) => ce.targetInstanceId === targetId)
              ).toBe(true);
          } else if (mode === "snapshot" || gate === "restriction")
            expect(additions).toHaveLength(0);
          if (gate === "restriction")
            expect(
              a.state.log.some((entry) =>
                entry.includes("blocked-by-restrict_symbol_addition:alice")
              )
            ).toBe(color === "red");
          const unprotected = build(secretA, color, mode, gate, false);
          expect(
            observation(unprotected).cards.find(
              (c) => c.instanceId === targetId
            )?.effectiveSymbols
          ).toEqual(["red", "blue"]);
        }
      );
    }
  }
});
