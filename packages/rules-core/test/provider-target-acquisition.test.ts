import { describe, expect, it } from "vitest";
import { BSTH10_CARDS } from "../../card-data/src/cards/BSTH10";
import {
  applyLegalAction,
  buildAiObservation,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type Action,
  type CardDefinition,
  type Effect,
  type GameState,
} from "../src";
import { resolveAffectSourceIdentity } from "../src/effect/effect-source-identity";
import {
  resolveTargets,
  resolveTargetCandidateIds,
} from "../src/effect/native-target-resolution";
import { executeEffectResistance } from "../src/effect/structured-continuous-effects";
import { executeRedirectTarget } from "../src/effect/native-ce-registration-handlers";
import { resumeTargetedDisclosureIfReady } from "../src/legal/stack-resolution-core";
import { getAvailableFieldCardEffectLegalActions } from "../src/legal/legal-actions-availability";
import { getCandidateTargetInstanceIds } from "../src/legal/legal-actions-shared";
import { isActiveTextRoleUnderEffectSource } from "../src/mechanics/star-garment-utils";

const card: CardDefinition = {
  cardNo: "PROVIDER-ACQUISITION-TARGET",
  name: "Provider acquisition target",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  textLines: [],
  keywordTags: [],
};

function fixture(options: {
  operation: "bp_modify" | "symbol_add";
  role?: "text_role" | "brave";
  count?: 1 | "all";
  providerColor?: "blue" | "red";
  bypass?: "all_effects" | "blanket_affect_immunity";
  target?: CardDefinition;
  repeatAdditional?: number;
  stepCount?: 1 | 2;
}) {
  const role = options.role ?? "text_role";
  const providerColor = options.providerColor ?? "blue";
  const action = {
    kind: options.operation,
    target: {
      kind: "filter",
      player: "opponent",
      zone: "field",
      count: options.count ?? 1,
      filter: { category: ["spirit"] },
    },
    duration: { scope: "turn" },
    ...(options.operation === "bp_modify"
      ? { amount: 1000 }
      : { symbol: "blue" }),
  } as Extract<Action, { kind: "bp_modify" | "symbol_add" }>;
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    textRef: [0, 1],
    ...(options.bypass
      ? {
          preventionLevel: "unpreventable",
          targetLockBypass: { kind: options.bypass },
        }
      : {}),
    steps: Array.from({ length: options.stepCount ?? 1 }, () => ({
      action,
      ...(options.repeatAdditional !== undefined
        ? {
            targetSelectionTiming: "on_step" as const,
            repeat: { additional: options.repeatAdditional },
          }
        : {}),
    })),
  };
  const hostDef: CardDefinition = {
    ...card,
    cardNo: "PROVIDER-ACQUISITION-HOST",
    colors: [providerColor === "blue" ? "red" : "blue"],
    underCardSlots: [{ roleTag: "バレットエディット", maxCount: 1 }],
  };
  const providerDef: CardDefinition = {
    ...card,
    cardNo: "PROVIDER-ACQUISITION-SOURCE",
    printedCategory: role === "brave" ? "brave" : "spirit",
    colors: [providerColor],
    effects: [effect],
    textLines: [
      role === "brave"
        ? "【合体中】"
        : "（自分の【バレットエディット】でスピリットの下にあるこのカードは以下の効果を発揮する。）",
      "相手のスピリットにBPまたはシンボルを追加する。",
    ],
  };
  const targetDef = options.target ?? card;
  const getDef = (id: string) =>
    [hostDef, providerDef, targetDef].find((def) => def.cardNo === id);
  const host = createCardInstance(hostDef, {
    instanceId: "host",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 1,
  });
  const provider = createCardInstance(providerDef, {
    instanceId: "provider",
    ownerPlayerId: "alice",
    zone: "field",
    normalCoreCount: 0,
    attachedToInstanceId: "host",
  });
  if (role === "text_role") {
    host.underCards = [
      {
        cardInstanceId: "provider",
        role: "text_role",
        roleTag: "バレットエディット",
      },
    ];
  } else {
    host.attachedChildrenIds = ["provider"];
  }
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        host,
        provider,
        createCardInstance(targetDef, {
          instanceId: "target",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    step: "main" as const,
    activePlayerId: "alice",
  };
  if (role === "text_role") {
    expect(
      isActiveTextRoleUnderEffectSource({
        state,
        hostCard: host,
        hostDefinition: hostDef,
        effectSourceInstanceId: "provider",
        effectSourceDefinitionId: providerDef.cardNo,
      })
    ).toBe(true);
  }
  const identity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId: "host",
    sourceDefinition: hostDef,
    effectSourceInstanceId: "provider",
    effectSourceDefinition: providerDef,
    getCardDefinitionById: getDef,
  });
  expect(identity.instanceId).toBe(role === "brave" ? "host" : "provider");
  const lookup = buildFieldCardEffectLookup([providerDef]);
  return {
    action,
    effect,
    state,
    identity,
    hostDef,
    providerDef,
    targetDef,
    getDef,
    registration: lookup(providerDef.cardNo)![0]!,
    lookups: {
      getCardDefinitionById: getDef,
      getRegisteredFieldCardEffectActions: lookup,
      getRegisteredTriggeredEffectActions: () => undefined,
    },
  };
}

function assertPath(
  f: ReturnType<typeof fixture>,
  state: GameState,
  applied: boolean
) {
  const expected = applied ? ["target"] : [];
  const manual =
    f.action.target.kind === "filter" && f.action.target.count !== "all";
  if (manual) {
    expect(
      getCandidateTargetInstanceIds(state, "alice", f.registration, {
        sourceInstanceId: "host",
        getCardDefinitionById: f.getDef,
        affectSourceIdentity: f.identity,
      })
    ).toEqual(expected);
  }
  expect(
    resolveTargets(
      f.action,
      state,
      "alice",
      "host",
      f.getDef,
      {},
      undefined,
      f.hostDef,
      f.effect.preventionLevel,
      f.effect.targetLockBypass,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "provider",
      f.providerDef
    )
  ).toEqual(expected);
  const legal = getAvailableFieldCardEffectLegalActions({
    state,
    actingPlayerId: "alice",
    ...f.lookups,
  }).find((entry) => entry.sourceInstanceId === "host")!;
  expect(legal).toMatchObject({
    can: true,
    sourceEffectInstanceId: "provider",
    ...(manual ? { candidateTargetInstanceIds: expected } : {}),
  });
  let after = applyLegalAction({
    state,
    action: legal,
    ...(manual ? { targetInstanceIds: expected } : {}),
    ...f.lookups,
  }).state;
  const pass = getLegalActions({
    state: after,
    actingPlayerId: "bob",
    ...f.lookups,
  }).find((entry) => entry.can && entry.kind === "pass_stack")!;
  expect(pass).toMatchObject({ kind: "pass_stack", actingPlayerId: "bob" });
  after = applyLegalAction({ state: after, action: pass, ...f.lookups }).state;
  expect(after.activeStack ?? null).toBeNull();
  expect(after.pendingFieldCardEffectResolution ?? null).toBeNull();
  for (const viewpointPlayerId of ["alice", "bob"]) {
    const target = buildAiObservation({
      state: after,
      viewpointPlayerId,
      getCardDefinitionById: f.getDef,
    }).cards.find((token) => token.instanceId === "target")!;
    expect(target.effectiveBp).toBe(
      f.targetDef.levelDefs![0]!.bp! +
        (applied && f.action.kind === "bp_modify" ? 1000 : 0)
    );
    expect(target.effectiveSymbols).toEqual([
      ...(f.targetDef.symbolColors ?? []),
      ...(applied && f.action.kind === "symbol_add" ? ["blue"] : []),
    ]);
  }
}

describe("継承効果の対象取得とprovider identity", () => {
  it.each(
    (
      [
        { role: "text_role", providerColor: "blue", redirected: true },
        { role: "text_role", providerColor: "red", redirected: false },
        { role: "brave", providerColor: "blue", redirected: false },
        { role: "brave", providerColor: "red", redirected: true },
      ] as const
    ).flatMap((entry) =>
      ([1, 2] as const).flatMap((stepCount) =>
        [0, 1, 2].map((additional) => ({ ...entry, additional, stepCount }))
      )
    )
  )(
    "on_step steps=$stepCount additional=$additional preserves $role/$providerColor provider through every disclosure and final board",
    ({ role, providerColor, redirected, additional, stepCount }) => {
      const target = BSTH10_CARDS.find((def) => def.cardNo === "BSTH10-C04")!;
      const f = fixture({
        operation: "bp_modify",
        role,
        providerColor,
        target,
        repeatAdditional: additional,
        stepCount,
      });
      const originalDef: CardDefinition = {
        ...card,
        cardNo: "PROVIDER-REPEAT-ORIGINAL",
        name: "Original",
        effects: [
          {
            timing: { kind: "game_event", player: "self", event: "targeted" },
            steps: [
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
        ],
      };
      const extraDef: CardDefinition = {
        ...card,
        cardNo: "PROVIDER-REPEAT-EXTRA",
        name: "Extra",
      };
      const getDef = (id: string) =>
        [originalDef, extraDef].find(
          (definition) => definition.cardNo === id
        ) ?? f.getDef(id);
      const lookups = {
        ...f.lookups,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          originalDef,
        ]),
      };
      let state: GameState = {
        ...f.state,
        cardInstances: [
          ...f.state.cardInstances,
          createCardInstance(originalDef, {
            instanceId: "original",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(extraDef, {
            instanceId: "extra",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const resistance = target.effects!.find((effect) =>
        effect.steps.some((step) => step.action.kind === "effect_resistance")
      )!;
      state = executeEffect({
        chainId: "provider-repeat-lock",
        state,
        effect: resistance,
        sourceInstanceId: "target",
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
      });
      state = executeEffect({
        chainId: `provider-repeat:${role}:${providerColor}:${additional}`,
        state,
        effect: f.effect,
        effectIndex: 0,
        sourceInstanceId: "host",
        effectSourceInstanceId: "provider",
        effectSourceDefinitionId: f.providerDef.cardNo,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
      });
      const candidates = redirected
        ? ["target", "original", "extra"]
        : ["original", "extra"];
      const reactionIds = new Set<string>();
      const disclosureIds = new Set<string>();
      const activationCount = stepCount * (additional + 1);
      for (let activation = 0; activation < activationCount; activation++) {
        const round = activation % (additional + 1);
        const stepIndex = Math.floor(activation / (additional + 1));
        expect(
          state.pendingStepOptionalTargetSelection?.candidateInstanceIds
        ).toEqual(candidates);
        const selection = getLegalActions({
          state,
          actingPlayerId: "alice",
          ...lookups,
        }).find(
          (entry) =>
            entry.can &&
            entry.kind === "resolve_pending_step_optional_target_selection"
        )!;
        expect(selection).toBeDefined();
        state = applyLegalAction({
          state,
          action: selection,
          targetInstanceIds: ["original"],
          ...lookups,
        }).state;
        expect(state.pendingTargetedDisclosureContinuation).toMatchObject({
          sourceInstanceId: "host",
          effectSourceInstanceId: "provider",
          resumeStepIndex: stepIndex,
          targetInstanceIds: ["original"],
          targetCandidateInstanceIds: candidates,
        });
        const disclosureId =
          state.pendingTargetedDisclosureContinuation!.pendingId;
        expect(disclosureIds.has(disclosureId)).toBe(false);
        disclosureIds.add(disclosureId);
        const reaction = state.pendingTriggeredEffects.find(
          (pending) => pending.eventKind === "targeted"
        )!;
        expect(reaction).toBeDefined();
        expect(reactionIds.has(reaction.pendingId)).toBe(false);
        reactionIds.add(reaction.pendingId);
        if (round > 0) {
          expect(
            state.pendingTargetedDisclosureContinuation?.repeatResume
          ).toMatchObject({
            nextAdditionalIndex: round - 1,
            additionalCount: additional,
          });
        }
        state = executeRedirectTarget(
          {
            kind: "redirect_target",
            from: {
              kind: "filter",
              player: "self",
              count: 1,
              filter: { cardName: { exact: "Original" } },
            },
            to: {
              kind: "filter",
              player: "self",
              count: 1,
              filter: { cardName: { exact: target.name } },
            },
          },
          state,
          "bob",
          "target",
          getDef,
          { results: {} }
        );
        expect(
          state.pendingTargetedDisclosureContinuation?.targetInstanceIds
        ).toEqual(redirected ? ["target"] : ["original"]);
        for (
          let i = 0;
          i < 12 && state.pendingTargetedDisclosureContinuation;
          i++
        ) {
          const response = ["bob", "alice"]
            .flatMap((actingPlayerId) =>
              getLegalActions({ state, actingPlayerId, ...lookups })
            )
            .find(
              (entry) =>
                entry.can &&
                (entry.kind === "resolve_pending_triggered_effect" ||
                  entry.kind === "select_pending_to_resolve" ||
                  entry.kind === "pass_stack")
            );
          if (!response) break;
          state = applyLegalAction({
            state,
            action: response,
            ...lookups,
          }).state;
        }
        state = resumeTargetedDisclosureIfReady(state, lookups);
        expect(
          state.players.find((player) => player.id === "bob")?.countValue
        ).toBe(activation + 1);
      }
      expect(reactionIds.size).toBe(activationCount);
      expect(disclosureIds.size).toBe(activationCount);
      expect(state.pendingTargetedDisclosureContinuation).toBeNull();
      // Mandatory BP repeats stage their target groups until the final choice.
      // Check every disclosure above, then the completed effect's total here.
      for (const viewpointPlayerId of ["alice", "bob"]) {
        const observation = buildAiObservation({
          state,
          viewpointPlayerId,
          getCardDefinitionById: getDef,
        });
        expect(
          observation.cards.find((entry) => entry.instanceId === "original")
            ?.effectiveBp
        ).toBe(3000 + (!redirected ? 1000 * activationCount : 0));
        expect(
          observation.cards.find((entry) => entry.instanceId === "target")
            ?.effectiveBp
        ).toBe(
          target.levelDefs![0]!.bp! + (redirected ? 1000 * activationCount : 0)
        );
        expect(
          observation.cards.find((entry) => entry.instanceId === "extra")
            ?.effectiveBp
        ).toBe(3000);
      }
      expect(state.pendingStepOptionalTargetSelection).toBeNull();
      expect(state.activeStack ?? null).toBeNull();
      expect(state.pendingFieldCardEffectResolution ?? null).toBeNull();
      expect(state.pendingEffectCompletions).toEqual([]);
      expect(state.pendingTriggeredEffects).toEqual([]);
      expect(state.pendingDeferredTriggeredEffects).toEqual([]);
      expect(state.pendingPrivateDeclarations).toEqual([]);
    }
  );

  it.each([
    { role: "text_role", providerColor: "blue", redirected: true },
    { role: "text_role", providerColor: "red", redirected: false },
    { role: "brave", providerColor: "blue", redirected: false },
    { role: "brave", providerColor: "red", redirected: true },
  ] as const)(
    "disclosure redirects use $role/$providerColor provider through resumed resolution",
    ({ role, providerColor, redirected }) => {
      const target = BSTH10_CARDS.find((def) => def.cardNo === "BSTH10-C04")!;
      const f = fixture({
        operation: "bp_modify",
        role,
        providerColor,
        target,
      });
      const originalDef: CardDefinition = {
        ...card,
        cardNo: "PROVIDER-REDIRECT-ORIGINAL",
        name: "Original",
        effects: [
          {
            timing: { kind: "game_event", player: "self", event: "targeted" },
            steps: [
              { action: { kind: "count_increase", player: "self", amount: 1 } },
            ],
          },
        ],
      };
      const getDef = (id: string) =>
        id === originalDef.cardNo ? originalDef : f.getDef(id);
      const lookups = {
        ...f.lookups,
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
          originalDef,
        ]),
      };
      let state: GameState = {
        ...f.state,
        cardInstances: [
          ...f.state.cardInstances,
          createCardInstance(originalDef, {
            instanceId: "original",
            ownerPlayerId: "bob",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      };
      const resistance = target.effects!.find((effect) =>
        effect.steps.some((step) => step.action.kind === "effect_resistance")
      )!;
      state = executeEffect({
        chainId: `provider-redirect-lock:${providerColor}`,
        state,
        effect: resistance,
        sourceInstanceId: "target",
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
      });
      state = executeEffect({
        chainId: `provider-redirect:${providerColor}`,
        state,
        effect: f.effect,
        effectIndex: 0,
        sourceInstanceId: "host",
        effectSourceInstanceId: "provider",
        effectSourceDefinitionId: f.providerDef.cardNo,
        actingPlayerId: "alice",
        targetInstanceIds: ["original"],
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions:
          lookups.getRegisteredTriggeredEffectActions,
      });
      expect(state.pendingTargetedDisclosureContinuation).toMatchObject({
        sourceInstanceId: "host",
        effectSourceInstanceId: "provider",
        targetInstanceIds: ["original"],
        targetCandidateInstanceIds: redirected
          ? ["target", "original"]
          : ["original"],
      });
      state = executeRedirectTarget(
        {
          kind: "redirect_target",
          from: {
            kind: "filter",
            player: "self",
            count: 1,
            filter: { cardName: { exact: "Original" } },
          },
          to: {
            kind: "filter",
            player: "self",
            count: 1,
            filter: { cardName: { exact: target.name } },
          },
        },
        state,
        "bob",
        "target",
        getDef,
        { results: {} }
      );
      expect(
        state.pendingTargetedDisclosureContinuation?.targetInstanceIds
      ).toEqual(redirected ? ["target"] : ["original"]);
      for (
        let i = 0;
        i < 8 && state.pendingTargetedDisclosureContinuation;
        i++
      ) {
        const action = ["bob", "alice"]
          .flatMap((actingPlayerId) =>
            getLegalActions({ state, actingPlayerId, ...lookups })
          )
          .find(
            (entry) =>
              entry.can &&
              (entry.kind === "resolve_pending_triggered_effect" ||
                entry.kind === "pass_stack")
          );
        if (!action) break;
        state = applyLegalAction({ state, action, ...lookups }).state;
      }
      state = resumeTargetedDisclosureIfReady(state, lookups);
      expect(state.pendingTargetedDisclosureContinuation).toBeNull();
      expect(
        state.players.find((player) => player.id === "bob")?.countValue
      ).toBe(1);
      const observation = buildAiObservation({
        state,
        viewpointPlayerId: "bob",
        getCardDefinitionById: getDef,
      });
      expect(
        observation.cards.find((entry) => entry.instanceId === "original")
          ?.effectiveBp
      ).toBe(3000 + (!redirected ? 1000 : 0));
      expect(
        observation.cards.find((entry) => entry.instanceId === "target")
          ?.effectiveBp
      ).toBe(target.levelDefs![0]!.bp! + (redirected ? 1000 : 0));
    }
  );

  it.each(["text_role", "brave"] as const)(
    "core source disclosure candidates retain %s identity",
    (role) => {
      const f = fixture({ operation: "bp_modify", role });
      const state = executeEffectResistance(
        f.state,
        "bob",
        {
          kind: "effect_resistance",
          target: { player: "self", selfCard: true, count: 1 },
          resistType: "cannot_include",
          source: "opponent_effect",
          targetLockSourceFilter: { colors: ["blue"] },
          duration: { scope: "turn" },
        },
        "target",
        f.getDef
      );
      const action: Extract<Action, { kind: "core_move" }> = {
        kind: "core_move",
        amount: 1,
        from: {
          kind: "field_card",
          player: "opponent",
          filter: { category: ["spirit"] },
        },
        to: { kind: "reserve", player: "opponent" },
      };
      expect(
        resolveTargetCandidateIds(
          action,
          state,
          "alice",
          "host",
          f.getDef,
          {},
          f.hostDef,
          undefined,
          undefined,
          undefined,
          "provider",
          f.providerDef
        )
      ).toEqual(role === "brave" ? ["target"] : []);
    }
  );

  const selectors = [
    { resistType: "cannot_be_targeted", count: 1, applies: true },
    { resistType: "cannot_include", count: 1, applies: false },
    { resistType: "cannot_include", count: "all", applies: true },
  ] as const;
  for (const operation of ["bp_modify", "symbol_add"] as const) {
    for (const role of ["text_role", "brave"] as const) {
      for (const selector of selectors) {
        it.each(["red", "blue"] as const)(
          `${operation}/${role}/${selector.resistType}/${selector.count}/%s: 候補から実stack解決まで同じ効果源を使う`,
          (color) => {
            const f = fixture({ operation, role, count: selector.count });
            const state = executeEffectResistance(
              f.state,
              "bob",
              {
                kind: "effect_resistance",
                target: { player: "self", selfCard: true, count: 1 },
                resistType: selector.resistType,
                source: "opponent_effect",
                targetLockSourceFilter: { colors: [color] },
                duration: { scope: "turn" },
              },
              "target",
              f.getDef
            );
            const sourceColor = role === "brave" ? "red" : "blue";
            assertPath(f, state, !(selector.applies && sourceColor === color));
          }
        );
      }
    }
    it.each(["all_effects", "blanket_affect_immunity"] as const)(
      `${operation}/%s: 対象lock貫通と作用だけの貫通を混同しない`,
      (bypass) => {
        const f = fixture({ operation, bypass });
        const state = executeEffectResistance(
          f.state,
          "bob",
          {
            kind: "effect_resistance",
            target: { player: "self", selfCard: true, count: 1 },
            resistType: "cannot_be_targeted",
            source: "opponent_effect",
            targetLockSourceFilter: { colors: ["blue"] },
            duration: { scope: "turn" },
          },
          "target",
          f.getDef
        );
        assertPath(f, state, bypass === "all_effects");
      }
    );
    it.each(["blue", "red"] as const)(
      `${operation}/BSTH10-C04/%s provider: 印字の赤spirit対象耐性を実登録する`,
      (providerColor) => {
        const target = BSTH10_CARDS.find((def) => def.cardNo === "BSTH10-C04")!;
        expect(target.textLines).toContain(
          "相手は、このスピリットを、赤のスピリットの効果の対象にできず、含めない。"
        );
        const f = fixture({ operation, providerColor, target });
        const resistance = target.effects!.find((effect) =>
          effect.steps.some((step) => step.action.kind === "effect_resistance")
        )!;
        const state = executeEffect({
          chainId: `provider-lock:${operation}:${providerColor}`,
          state: f.state,
          effect: resistance,
          sourceInstanceId: "target",
          actingPlayerId: "bob",
          getCardDefinitionById: f.getDef,
        });
        assertPath(f, state, providerColor === "blue");
      }
    );
  }
});
