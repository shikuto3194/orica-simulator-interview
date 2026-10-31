import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  runStateBasedActions,
  type CardDefinition,
  type GameState,
  type Effect,
} from "../src";
import {
  getBraveCapacitySeparationOptions,
  canReceiveBraveWithinCombineLimit,
} from "../src/legal/legal-actions-shared";

import { attachTargetedDisclosureResolutionCleanups } from "../src/legal/stack-resolution-core";
import { moveCardZone } from "../src/core/core-system";
import {
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
} from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  collectTriggerEventsFromStateDelta,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";

const marisas = ["BSTH01-X02", "BSTH02-X04", "BSTH08-C05", "BSTH09-M02"].map(
  (id) => ALL_CARDS.find((c) => c.cardNo === id)!
);
const brave: CardDefinition = {
  cardNo: "TEST-CAPACITY-BRAVE",
  name: "ミニ八卦炉",
  printedCategory: "brave",
  colors: ["yellow"],
  cost: 2,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  tribe: "導魔",
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const extraDefs = new Map<string, CardDefinition>();
const lookup = (id: string) =>
  extraDefs.get(id) ??
  (id === brave.cardNo ? brave : ALL_CARDS.find((c) => c.cardNo === id));
function fixture(hostDef = marisas[1], ids = ["a", "b"], cores = 2): GameState {
  const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...state,
    activePlayerId: "bob",
    step: "main",
    turnNumber: 3,
    cardInstances: [
      {
        ...createCardInstance(hostDef, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: cores,
        }),
        attachedChildrenIds: ids,
      },
      ...ids.map((instanceId) => ({
        ...createCardInstance(brave, {
          instanceId,
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 0,
        }),
        attachedToInstanceId: "host",
      })),
    ],
  };
}
function suppress(state: GameState, effectIndex = 1): GameState {
  return {
    ...state,
    activeContinuousEffects: [
      ...state.activeContinuousEffects,
      {
        effectId: "suppression",
        sourceInstanceId: "host",
        sourceDefinitionId: state.cardInstances[0].definitionId,
        actingPlayerId: "bob",
        targetInstanceId: "host",
        modifierTag: "effect_suppression",
        metadata: { effectFilter: { effectIndex } },
        duration: { scope: "turn" },
        createdAtTurn: 3,
        createdAtAttackId: null,
      },
    ],
  };
}
function choices(state: GameState) {
  return getBraveCapacitySeparationOptions({
    state,
    host: state.cardInstances[0],
    getCardDefinitionById: lookup,
  })
    .map((ids) => ids.join(","))
    .sort();
}
function resolve(
  state: GameState,
  kind:
    | "resolve_pending_zone_selection"
    | "resolve_pending_core_distribution"
    | "resolve_pending_step_optional_target_selection",
  inputs: Partial<Parameters<typeof applyLegalAction>[0]>
) {
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
  }).find((a) => a.kind === kind);
  expect(action).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    ...inputs,
  }).state;
}

describe("合体上限喪失は持ち主が合法な残留集合を選ぶ (Q3322/Q9555/Q15378/Q11020)", () => {
  it("合体数にはブレイヴ以外の添付物と欠落参照を含めない", () => {
    const state = fixture(marisas[0], ["a"]);
    const host = state.cardInstances[0];
    host.attachedChildrenIds.push("nonbrave", "missing");
    state.cardInstances.push({
      ...createCardInstance(marisas[0], {
        instanceId: "nonbrave",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedToInstanceId: host.instanceId,
    });
    expect(choices(suppress(state))).toEqual([]);
  });
  it("強制分離でも配置禁止のブレイヴにコア選択を出さない", () => {
    const forbidden: CardDefinition = {
      ...brave,
      cardNo: "TEST-FORBIDDEN-RULE-SEPARATION",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      keywordTags: ["enter_field_core_placement_forbidden"],
    };
    extraDefs.set(forbidden.cardNo, forbidden);
    const state = fixture();
    state.cardInstances[1] = {
      ...createCardInstance(forbidden, {
        instanceId: "a",
        ownerPlayerId: "alice",
        zone: "field",
      }),
      attachedToInstanceId: "host",
    };
    let after = runStateBasedActions(suppress(state), lookup).state;
    after = resolve(after, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["a"],
    });
    expect(after.pendingCoreDistribution).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "a")
    ).toMatchObject({
      zone: "field",
      attachedToInstanceId: null,
      normalCoreCount: 0,
    });
    expect(
      after.cardInstances.find((card) => card.instanceId === "host")
        ?.normalCoreCount
    ).toBe(2);
  });
  it("Q367: コア0の直接破棄は第三者の離脱誘発を作らず、トラッシュ増加は保持する", () => {
    const sortie = ALL_CARDS.find((c) => c.cardNo === "BSAZ01-C06")!;
    const house = ALL_CARDS.find((c) => c.cardNo === "BSTH02.7-TR01(A)")!;
    for (const definition of expandCardDefinitionsWithBackFaces([house]))
      extraDefs.set(definition.cardNo, definition);
    const registrations = buildTriggeredEffectLookup([sortie, house]);
    let before = fixture();
    before.cardInstances.push(
      createCardInstance(sortie, {
        instanceId: "sortie",
        ownerPlayerId: "alice",
        zone: "trash",
      })
    );
    before.cardInstances.push(
      createCardInstance(house, {
        instanceId: "house",
        ownerPlayerId: "alice",
        zone: "field",
      })
    );
    before = runStateBasedActions(suppress(before), lookup).state;
    before = resolve(before, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["a"],
    });
    const discarded = resolve(before, "resolve_pending_core_distribution", {
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
    });
    const observe = (beforeState: GameState, afterState: GameState) => {
      const options = {
        beforeState,
        afterState,
        source: "action_resolution" as const,
        chainId: "test:q367",
        attackId: null,
        causedByPlayerId: "bob",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: registrations,
        getRegisteredBurstActions: undefined,
      };
      const events = collectTriggerEventsFromStateDelta(options)
        .filter((e) => e.relatedInstanceId === "a")
        .map((e) => e.eventKind);
      const queued = collectAndQueueTriggerReactions(options);
      const observers = queued.pendingTriggeredEffects.flatMap(
        (pendingEffect) =>
          getAvailableTriggeredEffectSourceChoices({
            state: queued,
            pendingEffect,
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions: registrations,
          }).map((choice) => choice.sourceCard.instanceId)
      );
      return { events, observers, queued };
    };
    expect(
      discarded.cardInstances.find((c) => c.instanceId === "a")?.zone
    ).toBe("trash");
    const ruleDiscard = observe(before, discarded);
    expect(ruleDiscard.events).toContain("trash_increase");
    expect(ruleDiscard.events).not.toContain("leave_field");
    expect(ruleDiscard.observers).not.toContain("sortie");
    expect(ruleDiscard.observers).toContain("house");
    // Resolve the actual trash-increase observer, including its post-rebirth cores.
    let applied = ruleDiscard.queued;
    const lookups = {
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: registrations,
      getRegisteredBurstActions: () => [],
      getRegisteredFieldCardEffectActions: () => [],
    };
    const declaration = getLegalActions({
      state: applied,
      actingPlayerId: "alice",
      ...lookups,
    }).find(
      (action) =>
        action.kind === "resolve_pending_triggered_effect" &&
        action.sourceInstanceId === "house"
    );
    expect(declaration).toBeDefined();
    applied = applyLegalAction({
      state: applied,
      action: declaration!,
      ...lookups,
    }).state;
    for (let pass = 0; pass < 4 && applied.stackWindow; pass++) {
      const action = ["alice", "bob"]
        .flatMap((actingPlayerId) =>
          getLegalActions({ state: applied, actingPlayerId, ...lookups })
        )
        .find((action) => action.kind === "pass_stack");
      expect(action).toBeDefined();
      applied = applyLegalAction({
        state: applied,
        action: action!,
        ...lookups,
      }).state;
    }
    expect(
      applied.pendingCoreDistribution?.rebirthCompletion?.sourceInstanceId
    ).toBe("house");
    const placement = getLegalActions({
      state: applied,
      actingPlayerId: "alice",
      ...lookups,
    }).find((action) => action.kind === "resolve_pending_core_distribution");
    expect(placement).toBeDefined();
    applied = applyLegalAction({
      state: applied,
      action: placement!,
      ...lookups,
      coreDistributionAllocations: { house: 1 },
      coreDistributionSourceAllocations: { reserve: 1 },
    }).state;
    expect(
      applied.cardInstances.find((card) => card.instanceId === "house")
    ).toMatchObject({
      definitionId: "BSTH02.7-TR01(B)",
      normalCoreCount: 1,
      zone: "field",
    });
    expect(
      applied.players.find((player) => player.id === "alice")?.countValue
    ).toBe(1);

    // An ordinary departure still activates the actual third-party card.
    const normal = observe(before, moveCardZone(before, "a", "trash"));
    expect(normal.events).toContain("leave_field");
    expect(normal.observers).toContain("sortie");
    // Neither an old log nor a prior discard in this same delta suppresses
    // a later genuine departure of the same physical card.
    const returned = moveCardZone(discarded, "a", "field");
    const departedAgain = moveCardZone(returned, "a", "trash");
    for (const snapshot of [before, returned]) {
      const later = observe(snapshot, departedAgain);
      expect(later.events).toContain("leave_field");
      expect(later.observers).toContain("sortie");
    }
  });
  it.each([false, true])(
    "native分離のSBAを先に解決し、元の結果と反復を保持する repeat=%s",
    (repeat) => {
      const free: CardDefinition = {
        ...brave,
        cardNo: "TEST-FREE-SEPARATION",
        cost: 2,
        levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
        keywordTags: ["enter_field_core_placement_forbidden"],
      };
      const conditional: CardDefinition = {
        ...brave,
        cardNo: "TEST-COST-CONDITIONAL",
        cost: 0,
        braveCondition: { minCost: marisas[1].cost + 2 },
      };
      const stable = { ...free, cardNo: "TEST-STABLE-SEPARATION", cost: 0 };
      for (const d of [free, conditional, stable]) extraDefs.set(d.cardNo, d);
      let state = fixture(marisas[1], ["a", "b", "c"], 3);
      state.cardInstances = state.cardInstances.map((c) => {
        const def =
          c.instanceId === "a"
            ? free
            : c.instanceId === "b"
              ? conditional
              : c.instanceId === "c"
                ? stable
                : undefined;
        return def
          ? { ...c, definitionId: def.cardNo, originalDefinitionId: def.cardNo }
          : c;
      });
      state.cardInstances.push(
        {
          ...createCardInstance(marisas[1], {
            instanceId: "other-host",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 2,
          }),
          attachedChildrenIds: ["d"],
        },
        {
          ...createCardInstance(stable, {
            instanceId: "d",
            ownerPlayerId: "alice",
            zone: "field",
          }),
          attachedToInstanceId: "other-host",
        },
        createCardInstance(brave, {
          instanceId: "deck-native",
          ownerPlayerId: "alice",
          zone: "deck",
        })
      );
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "separated",
            targetSelectionTiming: "on_step",
            ...(repeat ? { repeat: { additional: 1 } } : {}),
            action: {
              kind: "brave_separate_effect",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["brave"] },
                count: 1,
              },
            },
          },
          {
            stepCondition: {
              kind: "all",
              conditions: [
                { kind: "ref_succeeded", stepId: "separated" },
                {
                  kind: "ref_count",
                  stepId: "separated",
                  min: repeat ? 2 : 1,
                  max: repeat ? 2 : 1,
                },
              ],
            },
            action: { kind: "draw", count: 1 },
          },
        ],
      };
      state = executeEffect({
        state,
        effect,
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        chainId: "test:native-separation",
        targetInstanceIds: ["a"],
        targetStepId: "separated",
        targetSelectionResolved: true,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(state.pendingStepOptionalTargetSelection).toBeNull();
      expect(
        state.pendingCoreDistribution?.stateBasedBraveSeparation
          ?.braveInstanceId
      ).toBe("b");
      expect(
        state.pendingCoreDistribution?.continuation?.stepContext.results
          .separated?.affectedCardInstanceIds
      ).toEqual(["a"]);
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck-native")?.zone
      ).toBe("deck");
      state = resolve(state, "resolve_pending_core_distribution", {
        coreDistributionAllocations: {},
        coreDistributionSourceAllocations: {},
      });
      if (repeat) {
        expect(state.pendingStepOptionalTargetSelection).not.toBeNull();
        state = resolve(
          state,
          "resolve_pending_step_optional_target_selection",
          { targetInstanceIds: ["c"] }
        );
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck-native")?.zone
      ).toBe("hand");
      expect(
        state.log.filter((l) => l.startsWith("effect:draw:"))
      ).toHaveLength(1);
      expect(
        state.cardInstances.find((c) => c.instanceId === "c")
          ?.attachedToInstanceId
      ).toBe(repeat ? null : "host");
    }
  );
  it("数に数えないC32は指定名の多重枠を消費せず、上限失効時も分離候補にしない", () => {
    const key = ALL_CARDS.find((c) => c.cardNo === "BSTH003-C32")!;
    for (const ids of [
      ["a", "key", "b"],
      ["key", "b", "a"],
      ["a", "b", "key"],
    ]) {
      let state = fixture(marisas[0], ids, 3);
      state.cardInstances = state.cardInstances.map((c) =>
        c.instanceId === "key"
          ? { ...c, definitionId: key.cardNo, originalDefinitionId: key.cardNo }
          : c
      );
      expect(choices(state)).toEqual([]);
      state = suppress(state);
      expect(choices(state)).toEqual(["a", "b"]);
    }
  });
  it("容量選択→連続コア選択をまたいで一時CEを保持し、最終確定で終了する", () => {
    let state = runStateBasedActions(
      suppress(fixture(marisas[1], ["a", "b", "c"])),
      lookup
    ).state;
    state.activeContinuousEffects.push({
      ...state.activeContinuousEffects[0],
      effectId: "temporary-response",
      modifierTag: "bp_change",
      amount: 1000,
    });
    state = attachTargetedDisclosureResolutionCleanups(state, [
      {
        kind: "continuous_effects",
        effectIds: ["temporary-response"],
      },
    ]);
    expect(
      state.pendingZoneSelection?.targetedDisclosureResolutionCleanups
    ).toHaveLength(1);
    state = resolve(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["a", "b"],
    });
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
    });
    expect(
      state.activeContinuousEffects.some(
        (e) => e.effectId === "temporary-response"
      )
    ).toBe(true);
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
    });
    expect(
      state.activeContinuousEffects.some(
        (e) => e.effectId === "temporary-response"
      )
    ).toBe(false);
    expect(state.pendingCoreDistribution).toBeNull();
  });
  it("M05の条件無視失効: 不適合を先に分離し、適合する残りから選ぶ (Q24909)", () => {
    const m05 = ALL_CARDS.find((c) => c.cardNo === "BSTH03-M05")!;
    const bad = {
      ...brave,
      cardNo: "TEST-CAPACITY-ILLEGAL",
      braveCondition: { minCost: 99 },
    };
    extraDefs.set(bad.cardNo, bad);
    let state = fixture(m05, ["a", "b", "c"]);
    state.cardInstances[3] = {
      ...state.cardInstances[3],
      definitionId: bad.cardNo,
      originalDefinitionId: bad.cardNo,
    };
    expect(
      runStateBasedActions(state, lookup).state.pendingCoreDistribution
    ).toBeNull();
    state = runStateBasedActions(suppress(state), lookup).state;
    expect(state.pendingZoneSelection).toBeNull();
    expect(
      state.pendingCoreDistribution?.stateBasedBraveSeparation?.braveInstanceId
    ).toBe("c");
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
    });
    expect(choices(state)).toEqual(["a", "b"]);
    expect(state.pendingZoneSelection?.candidateCardInstanceIds).not.toContain(
      "c"
    );
    expect(state.cardInstances.find((c) => c.instanceId === "c")?.zone).toBe(
      "trash"
    );
  });
  it("Lv2の多重枠をLv1で失い、再有効でも分離したカードを自動再合体しない", () => {
    const host: CardDefinition = {
      ...marisas[1],
      cardNo: "TEST-CAPACITY-LEVEL",
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
      effects: marisas[1].effects!.map((effect, i) =>
        i === 1
          ? { ...effect, applicability: { level: { min: 2, max: 2 } } }
          : effect
      ),
    };
    extraDefs.set(host.cardNo, host);
    let state = fixture(host);
    expect(choices(state)).toEqual([]);
    state.cardInstances[0].normalCoreCount = 1;
    state = runStateBasedActions(state, lookup).state;
    expect(choices(state)).toEqual(["a", "b"]);
    state = resolve(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["a"],
    });
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
    });
    state.cardInstances.find((c) => c.instanceId === "host")!.normalCoreCount =
      2;
    state = runStateBasedActions(state, lookup).state;
    expect(
      state.cardInstances.find((c) => c.instanceId === "host")
        ?.attachedChildrenIds
    ).toEqual(["b"]);
    expect(state.cardInstances.find((c) => c.instanceId === "a")?.zone).toBe(
      "trash"
    );
  });
  it("リザーブのソウルコアを選んで分離後のLv1を維持できる", () => {
    let state = fixture();
    state.players = state.players.map((p) =>
      p.id === "alice"
        ? {
            ...p,
            reserveSoulCoreCount: 1,
            soulCoreLocation: { kind: "reserve" },
          }
        : p
    );
    state = runStateBasedActions(suppress(state), lookup).state;
    state = resolve(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["b"],
    });
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: {},
      coreDistributionSourceAllocations: {},
      coreDistributionSoulCoreAllocations: { b: 1 },
      coreDistributionSoulCoreSourceAllocations: { reserve: 1 },
    });
    expect(state.cardInstances.find((c) => c.instanceId === "b")).toMatchObject(
      { zone: "field", attachedToInstanceId: null, soulCoreCount: 1 }
    );
    expect(
      state.players.find((p) => p.id === "alice")?.reserveSoulCoreCount
    ).toBe(0);
  });
  it.each(["after_state_check", "after_triggers"] as const)(
    "%s: 分離とコア選択を終えるまで後続のドローを実行せず一度だけ再開する",
    (connector) => {
      let state = fixture(marisas[1], ["a", "b", "c"]);
      state.cardInstances.push(
        createCardInstance(brave, {
          instanceId: "deck-card",
          ownerPlayerId: "alice",
          zone: "deck",
        })
      );
      const effect: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            id: "suppressed",
            action: {
              kind: "suppress_effect",
              target: { kind: "self" },
              duration: { scope: "turn" },
            },
          },
          { connector, action: { kind: "draw", count: 1 } },
        ],
      };
      state = executeEffect({
        state,
        effect,
        sourceInstanceId: "host",
        actingPlayerId: "alice",
        chainId: "test:brave-rule-choice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck-card")?.zone
      ).toBe("deck");
      expect(state.pendingZoneSelection).not.toBeNull();
      state = resolve(state, "resolve_pending_zone_selection", {
        selectedZoneCardIds: ["a", "b"],
      });
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck-card")?.zone
      ).toBe("deck");
      for (let i = 0; i < 2; i++) {
        state = resolve(state, "resolve_pending_core_distribution", {
          coreDistributionAllocations: {},
          coreDistributionSourceAllocations: {},
        });
        if (i === 0)
          expect(
            state.cardInstances.find((c) => c.instanceId === "deck-card")?.zone
          ).toBe("deck");
      }
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck-card")?.zone
      ).toBe("hand");
      expect(
        state.cardInstances.find((c) => c.instanceId === "host")
          ?.attachedChildrenIds
      ).toEqual(["c"]);
      expect(
        state.log.filter((line) => line.startsWith("effect:draw:"))
      ).toHaveLength(1);
    }
  );
  it("分離コアをホストの最後の1個から置くと残りは待機中の合体を維持する", () => {
    let state = runStateBasedActions(
      suppress(fixture(marisas[1], ["a", "b", "c"], 1)),
      lookup
    ).state;
    state = resolve(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["a", "b"],
    });
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: { a: 1 },
      coreDistributionSourceAllocations: { "field:host": 1 },
    });
    expect(state.pendingCoreDistribution).toBeNull();
    expect(state.pendingZoneSelection).toBeNull();
    // The usual leave-choice flow may now own the waiting host; no second
    // rule-separation choice or premature movement of its cores is permitted.
    expect(
      state.cardInstances.find((c) => c.instanceId === "b")
        ?.attachedToInstanceId
    ).toBe("host");
  });
  it.each(marisas)(
    "$cardNo: Lv1許可も本文効果の抑止に従い、他効果の抑止と区別する",
    (host) => {
      const state = fixture(host, ["a", "b"], 1);
      expect(host.maxCombinedBraves?.effectIndex).toBe(1);
      expect(choices(state)).toEqual([]);
      expect(choices(suppress(state, 0))).toEqual([]);
      expect(choices(suppress(state))).toEqual(["a", "b"]);
      expect(
        choices({ ...suppress(state), activeContinuousEffects: [] })
      ).toEqual([]);
    }
  );
  it.each(["a", "b"])(
    "順序反転でも%sを分離でき、相手ターンでも持ち主が選ぶ",
    (selected) => {
      for (const ids of [
        ["a", "b"],
        ["b", "a"],
      ]) {
        let state = runStateBasedActions(
          suppress(fixture(marisas[1], ids)),
          lookup
        ).state;
        expect(state.pendingZoneSelection?.actingPlayerId).toBe("alice");
        expect(
          getLegalActions({
            state,
            actingPlayerId: "bob",
            getCardDefinitionById: lookup,
          }).some((a) => a.kind === "resolve_pending_zone_selection")
        ).toBe(false);
        state = resolve(state, "resolve_pending_zone_selection", {
          selectedZoneCardIds: [selected],
        });
        expect(state.pendingCoreDistribution?.minTotal).toBe(0);
        state = resolve(state, "resolve_pending_core_distribution", {
          coreDistributionAllocations: {},
          coreDistributionSourceAllocations: {},
        });
        expect(
          state.cardInstances.find((c) => c.instanceId === selected)
        ).toMatchObject({
          zone: "trash",
          attachedToInstanceId: null,
          pendingLeaveKind: null,
        });
        expect(
          state.cardInstances.find((c) => c.instanceId === "host")
            ?.attachedChildrenIds
        ).toEqual(ids.filter((id) => id !== selected));
        expect(state.pendingLeaveEntities).toEqual([]);
        expect(state.pendingZoneSelection).toBeNull();
      }
    }
  );
  it("コア源が1つでも自動補填せず、選んで置くと分離後も場に残る (Q382)", () => {
    let state = runStateBasedActions(suppress(fixture()), lookup).state;
    state = resolve(state, "resolve_pending_zone_selection", {
      selectedZoneCardIds: ["a"],
    });
    state = resolve(state, "resolve_pending_core_distribution", {
      coreDistributionAllocations: { a: 1 },
      coreDistributionSourceAllocations: { "field:host": 1 },
    });
    expect(state.cardInstances.find((c) => c.instanceId === "a")).toMatchObject(
      { zone: "field", normalCoreCount: 1, attachedToInstanceId: null }
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "host")?.normalCoreCount
    ).toBe(1);
  });
  it.each(["destroy", "bounce", "vanish"] as const)(
    "%s待機中は上限を失っても合体を維持する (Ver17)",
    (kind) => {
      const state = suppress(fixture());
      state.cardInstances[0] = {
        ...state.cardInstances[0],
        pendingLeaveKind: kind,
      };
      const after = runStateBasedActions(state, lookup).state;
      expect(after.pendingZoneSelection).toBeNull();
      expect(after.pendingCoreDistribution).toBeNull();
      expect(after.cardInstances[0].attachedChildrenIds).toEqual(["a", "b"]);
    }
  );
  it("同じSBAで消滅待機へ入るホストも、古い分離チェックを適用しない", () => {
    const state = suppress(fixture(marisas[1], ["a", "b"], 0));
    const after = runStateBasedActions(state, lookup).state;
    expect(after.cardInstances[0].pendingLeaveKind).toBe("vanish");
    expect(after.cardInstances[0].attachedChildrenIds).toEqual(["a", "b"]);
    expect(after.pendingZoneSelection).toBeNull();
  });
  it.each(marisas)(
    "$cardNo: 指定外1つは通常枠、指定内外を混ぜた2つは両順序とも不可 (Q15380)",
    (hostDef) => {
      const foreign = {
        ...brave,
        cardNo: "FOREIGN",
        name: "別名",
        tribe: "機獣",
      };
      const getDef = (id: string) =>
        id === foreign.cardNo ? foreign : lookup(id);
      const can = (
        attached: CardDefinition | null,
        incoming: CardDefinition
      ) => {
        const state = fixture(hostDef, []);
        const host = state.cardInstances[0];
        if (attached) {
          host.attachedChildrenIds = ["old"];
          state.cardInstances.push({
            ...createCardInstance(attached, {
              instanceId: "old",
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 0,
            }),
            attachedToInstanceId: "host",
          });
        }
        const card = createCardInstance(incoming, {
          instanceId: "new",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        });
        state.cardInstances.push(card);
        return canReceiveBraveWithinCombineLimit({
          state,
          host,
          incomingBrave: card,
          incomingBraveDef: incoming,
          getCardDefinitionById: getDef,
        });
      };
      expect(can(null, foreign)).toBe(true);
      expect(can(foreign, brave)).toBe(false);
      expect(can(brave, foreign)).toBe(false);
    }
  );
});
