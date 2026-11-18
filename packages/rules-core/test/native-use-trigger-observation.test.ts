import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type LegalAction,
} from "../src";
import { moveCardZone, moveNormalCores } from "../src/core/core-system";
import {
  playMagicCardAsAction,
  resolveDeferredMagicStack,
  useMagicCardInFlashContextAsAction,
  useMagicCardWithoutPayingCostAsAction,
} from "../src/mechanics/magic-system";
import {
  useAccelCardAsAction,
  useAccelCardInFlashContextAsAction,
  resolveDeferredAccelStack,
} from "../src/mechanics/accel-change-system";

const printed = ALL_CARDS.find((card) => card.cardNo === "BSTH10.5-X01")!;
const observer: CardDefinition = {
  ...printed,
  cardNo: "TEST-USE-OBSERVER",
  grandwalkerData: {
    ...printed.grandwalkerData!,
    oracleConditions: [{ categories: ["magic", "spirit"] }],
    oracleTriggerKinds: ["use_magic", "use_accel"],
  },
  effects: [],
};
const magic: CardDefinition = {
  cardNo: "TEST-OBSERVED-MAGIC",
  name: "観測境界マジック",
  printedCategory: "magic",
  colors: ["blue"],
  cost: 0,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [],
  keywordTags: ["stack_effect"],
  textLines: [],
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        { action: { kind: "count_increase", player: "self", amount: 1 } },
      ],
    },
  ],
};
const pendingMagic: CardDefinition = {
  ...magic,
  cardNo: "TEST-PENDING-MAGIC",
  effects: [
    {
      timing: { kind: "activated", mode: "stack" },
      steps: [
        {
          executionMode: "optional",
          action: { kind: "count_increase", player: "self", amount: 1 },
        },
      ],
    },
  ],
};
const accel: CardDefinition = {
  ...magic,
  cardNo: "TEST-OBSERVED-ACCEL",
  printedCategory: "spirit",
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  effects: [],
  accelData: {
    cost: 0,
    reduction: [],
    timing: "flash",
    effects: [
      {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            executionMode: "optional",
            action: { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    ],
  },
};
const levelingObserver: CardDefinition = {
  ...observer,
  cardNo: "TEST-LEVELING-DOMAIN",
  effects: [
    {
      timing: { kind: "game_event", event: "effect_activated", player: "self" },
      steps: [
        {
          action: {
            kind: "core_move",
            from: { kind: "void", player: "self" },
            to: { kind: "this_card" },
            amount: 1,
          },
        },
      ],
    },
  ],
};
const colorObserver: CardDefinition = {
  ...observer,
  cardNo: "TEST-COLOR-USE-OBSERVER",
  grandwalkerData: {
    ...observer.grandwalkerData!,
    oracleConditions: [{ categories: ["magic"], colors: ["blue"] }],
  },
};
const handBlueMagic: CardDefinition = {
  ...pendingMagic,
  cardNo: "TEST-HAND-BLUE-MAGIC",
  colors: ["red"],
  effects: [
    ...pendingMagic.effects!,
    {
      timing: { kind: "continuous" },
      steps: [
        {
          action: {
            kind: "treat_as",
            aspects: ["color"],
            asColor: "blue",
            appliesToCard: true,
          },
        },
      ],
    },
  ],
};
const defs = [
  observer,
  printed,
  magic,
  pendingMagic,
  accel,
  levelingObserver,
  colorObserver,
  handBlueMagic,
];
const deps = {
  getCardDefinitionById: (id: string) =>
    defs.find((card) => card.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
};
function make(
  def: CardDefinition,
  id: string,
  zone: "field" | "hand" | "deck",
  owner = "alice",
  cores = 3
) {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? cores : 0,
  });
}
function fixture(def = magic, source = observer, cores = 3): GameState {
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make(def, "used", "hand"),
        make(source, "present", "field", "alice", cores),
        make(source, "late", "hand"),
        ...Array.from({ length: 8 }, (_, i) =>
          make(magic, `deck-${i}`, "deck", "bob")
        ),
      ],
      playerOverrides: [{ voidNormalCoreCount: 20 }, {}],
    }),
    step: "main",
  };
}
function sources(state: GameState, kind: "oracle" | "magic_stack_domain") {
  return state.pendingTriggeredEffects
    .filter((p) => p.mechanic?.kind === kind)
    .map((p) => p.relatedInstanceId);
}
function act(state: GameState, predicate: (a: LegalAction) => boolean) {
  const legal = ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
  const action = legal.find(predicate);
  expect(action, JSON.stringify(legal)).toBeDefined();
  state = applyLegalAction({ state, action: action!, ...deps }).state;
  if (
    action?.kind === "select_pending_to_resolve" &&
    !state.stackWindow &&
    state.pendingTriggeredEffects.some(
      (p) => p.pendingId === action.pendingId && p.selectedByTurnPlayer
    )
  ) {
    return act(
      state,
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === action.pendingId
    );
  }
  return state;
}
function close(state: GameState) {
  for (let i = 0; state.stackWindow && i < 12; i++)
    state = act(state, (a) => a.kind === "pass_stack");
  expect(state.stackWindow).toBeNull();
  return state;
}
function deferred(state: GameState) {
  return useMagicCardInFlashContextAsAction({
    state,
    actingPlayerId: "alice",
    magicInstanceId: "used",
    chosenTiming: "stack",
    paymentSources: [],
    ...deps,
  });
}

describe("native 使用時と効果発揮時の観測境界", () => {
  it("使用開始時の実効色は本文中断とJSON復元を越えて神託に渡る", () => {
    const declared = deferred(fixture(handBlueMagic, colorObserver));
    let state = resolveDeferredMagicStack({
      state: declared.state,
      activeStack: declared.activeStack,
      ...deps,
    });
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    state = JSON.parse(JSON.stringify(state));
    state = act(
      state,
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(state.cardInstances.find((c) => c.instanceId === "used")?.zone).toBe(
      "trash"
    );
    expect(sources(state, "oracle")).toEqual(["present"]);
  });
  it("使用/発揮時に抑止中だった創界神は、本文で解除されてもその事象を観測しない", () => {
    const initial = fixture();
    const state: GameState = {
      ...initial,
      activeContinuousEffects: [
        {
          effectId: "suppress-observer",
          sourceInstanceId: "present",
          sourceDefinitionId: observer.cardNo,
          actingPlayerId: "alice",
          targetInstanceId: "present",
          modifierTag: "effect_suppression",
          duration: { scope: "turn" },
          createdAtTurn: initial.turnNumber,
          createdAtAttackId: null,
          metadata: {},
        },
      ],
    };
    const after = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "used",
      chosenTiming: "stack",
      paymentSources: [],
      resolveEffect: (current) => ({ ...current, activeContinuousEffects: [] }),
      ...deps,
    }).state;
    expect(sources(after, "oracle")).toEqual([]);
    expect(sources(after, "magic_stack_domain")).toEqual([]);
  });
  it.each(["paid", "free"] as const)(
    "%s マジック本文で新配置した創界神は過去の使用/発揮を観測しない",
    (mode) => {
      const state = fixture();
      // Handwritten resolver is a supported production adapter; its zone primitive models the body placing a nexus.
      const resolveEffect = (current: GameState) =>
        moveCardZone(current, "late", "field");
      const after =
        mode === "paid"
          ? playMagicCardAsAction({
              state,
              actingPlayerId: "alice",
              magicInstanceId: "used",
              chosenTiming: "stack",
              paymentSources: [],
              resolveEffect,
              ...deps,
            }).state
          : useMagicCardWithoutPayingCostAsAction({
              state,
              actingPlayerId: "alice",
              magicInstanceId: "used",
              magicTiming: "stack",
              resolveEffect,
              ...deps,
            }).state;
      expect(
        after.cardInstances.find((c) => c.instanceId === "late")?.zone
      ).toBe("field");
      expect(sources(after, "oracle")).toEqual(["present"]);
      expect(sources(after, "magic_stack_domain")).toEqual(["present"]);
    }
  );
  it("無償使用の対象選択用syntheticStackにも使用開始時の観測元を渡す", () => {
    const after = useMagicCardWithoutPayingCostAsAction({
      state: fixture(),
      actingPlayerId: "alice",
      magicInstanceId: "used",
      magicTiming: "stack",
      ...deps,
      resolveDeferredStackForFreeMagicUse: (state, activeStack) =>
        resolveDeferredMagicStack({
          state: moveCardZone(state, "late", "field"),
          activeStack: JSON.parse(JSON.stringify(activeStack)),
          ...deps,
        }),
    }).state;
    expect(after.players[0]?.countValue).toBe(1);
    expect(sources(after, "oracle")).toEqual(["present"]);
  });
  it("スタック応答中の後入場は使用時神託を見ず、その後開始する効果発揮時導域は見る", () => {
    const declared = deferred(fixture());
    const atResolution = moveCardZone(declared.state, "late", "field");
    const after = resolveDeferredMagicStack({
      state: atResolution,
      activeStack: JSON.parse(JSON.stringify(declared.activeStack)),
      ...deps,
    });
    expect(after.players[0]?.countValue).toBe(1);
    expect(sources(after, "oracle")).toEqual(["present"]);
    expect(sources(after, "magic_stack_domain")).toEqual(["present", "late"]);
    const usage = after.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "oracle"
    )!;
    const activation = after.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "magic_stack_domain"
    )!;
    expect(usage.simultaneousGroupId).not.toBe(activation.simultaneousGroupId);
  });
  it("本文中断をJSON復元しても発揮開始時の観測元を保持する", () => {
    const declared = deferred(fixture(pendingMagic));
    let state = resolveDeferredMagicStack({
      state: declared.state,
      activeStack: declared.activeStack,
      ...deps,
    });
    expect(state.pendingStepOptionalChoice).not.toBeNull();
    expect(sources(state, "oracle")).toEqual([]);
    expect(sources(state, "magic_stack_domain")).toEqual([]);
    state = JSON.parse(
      JSON.stringify(moveCardZone(state, "late", "field"))
    ) as GameState;
    state = act(
      state,
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(state.players[0]?.countValue).toBe(1);
    expect(sources(state, "oracle")).toEqual(["present"]);
    expect(sources(state, "magic_stack_domain")).toEqual(["present"]);
  });
  it.each(["direct", "deferred"] as const)(
    "%s アクセルの本文pendingを越えて使用時観測を保持する",
    (mode) => {
      let state: GameState;
      if (mode === "direct")
        state = useAccelCardAsAction({
          state: fixture(accel),
          actingPlayerId: "alice",
          cardInstanceId: "used",
          accelData: accel.accelData!,
          paymentSources: [],
          ...deps,
        }).state;
      else {
        const declared = useAccelCardInFlashContextAsAction({
          state: fixture(accel),
          actingPlayerId: "alice",
          cardInstanceId: "used",
          accelData: accel.accelData!,
          paymentSources: [],
          ...deps,
        });
        state = resolveDeferredAccelStack({
          state: declared.state,
          activeStack: declared.activeStack,
          ...deps,
        });
      }
      expect(state.pendingStepOptionalChoice).not.toBeNull();
      expect(sources(state, "oracle")).toEqual([]);
      state = JSON.parse(
        JSON.stringify(moveCardZone(state, "late", "field"))
      ) as GameState;
      state = act(
        state,
        (a) =>
          a.kind === "resolve_pending_step_optional_choice" &&
          a.choice === "execute"
      );
      expect(state.players[0]?.countValue).toBe(1);
      expect(sources(state, "oracle")).toEqual(["present"]);
    }
  );
  it("導域Lv条件は同じ発揮事象の通常効果で満たせ、同じ群で宣言・解決できる", () => {
    const declared = deferred(fixture(magic, levelingObserver, 2));
    let state = resolveDeferredMagicStack({
      state: declared.state,
      activeStack: declared.activeStack,
      ...deps,
    });
    const domain = state.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "magic_stack_domain"
    )!;
    const normal = state.pendingTriggeredEffects.find(
      (p) => !p.mechanic && p.eventKind === "effect_activated"
    )!;
    expect(domain.dormantMechanic).toBe(true);
    expect(domain.dormantMechanicCondition).toBe(true);
    expect(normal.simultaneousGroupId).toBe(domain.simultaneousGroupId);
    // Use-time is distinct. Resolve its optional oracle by declining before selecting activation siblings.
    const oracle = state.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "oracle"
    )!;
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...deps,
    });
    const oracleAction = actions.find(
      (a) =>
        a.pendingId === oracle.pendingId &&
        a.kind === "resolve_pending_triggered_effect"
    );
    if (oracleAction)
      state = applyLegalAction({
        state,
        action: oracleAction,
        skipOptionalEffect: true,
        ...deps,
      }).state;
    state = close(
      act(
        state,
        (a) =>
          a.pendingId === normal.pendingId &&
          (a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "select_pending_to_resolve")
      )
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "present")
        ?.normalCoreCount
    ).toBe(3);
    const enabledDomain = state.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "magic_stack_domain"
    )!;
    expect(enabledDomain.simultaneousGroupId).toBe(domain.simultaneousGroupId);
    expect(enabledDomain.activationPriority).toBeDefined();
    state = close(
      act(
        state,
        (a) =>
          a.pendingId === enabledDomain.pendingId &&
          (a.kind === "resolve_pending_triggered_effect" ||
            a.kind === "select_pending_to_resolve")
      )
    );
    expect(
      state.cardInstances.filter(
        (c) => c.controllerPlayerId === "bob" && c.zone === "trash"
      )
    ).toHaveLength(4);
    expect(
      state.cardInstances.find((c) => c.instanceId === "present")
        ?.normalCoreCount
    ).toBe(4);
  });
  it("Lv2で導域を宣言した後のLv低下は、宣言済みのデッキ破棄を止めない", () => {
    const declared = deferred(fixture());
    let state = resolveDeferredMagicStack({
      state: declared.state,
      activeStack: declared.activeStack,
      ...deps,
    });
    const domain = state.pendingTriggeredEffects.find(
      (p) => p.mechanic?.kind === "magic_stack_domain"
    )!;
    state = act(
      state,
      (a) =>
        a.pendingId === domain.pendingId &&
        (a.kind === "resolve_pending_triggered_effect" ||
          a.kind === "select_pending_to_resolve")
    );
    expect(state.stackWindow).not.toBeNull();
    state = moveNormalCores(
      state,
      { kind: "card", instanceId: "present" },
      { kind: "reserve", playerId: "alice" },
      1
    );
    state = close(state);
    expect(
      state.cardInstances.filter(
        (c) => c.ownerPlayerId === "bob" && c.zone === "trash"
      )
    ).toHaveLength(4);
    expect(
      state.cardInstances.find((c) => c.instanceId === "present")
        ?.normalCoreCount
    ).toBe(3);
  });
});
