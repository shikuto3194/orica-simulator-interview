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
  type SupplementalTriggerEvent,
  type TriggeredMechanic,
} from "../src";
import { moveCardZone, moveNormalCores } from "../src/core/core-system";
import { captureTriggerObservation } from "../src/effect/trigger-observation-sources";
import { captureTriggerEventFacts } from "../src/effect/trigger-event-facts";
import {
  collectAndQueueTriggerReactions,
  pruneIllegalPendingTriggeredEffects,
} from "../src/effect/trigger-system";
import {
  getTriggeredMechanicActivationState,
  isTriggeredMechanicExplicitConditionNewlyEnabled,
} from "../src/effect/triggered-mechanic-eligibility";
import { checkAndQueueStoneRebirthChoices } from "../src/mechanics/grandstone-system";
import { queueFieldEntryOracleReactions } from "../src/mechanics/oracle-system";
import { seedOracleTriggerUsage } from "./helpers/oracle-usage-fixture";

const real = (no: string) => ALL_CARDS.find((card) => card.cardNo === no)!;
const oracle: CardDefinition = {
  ...real("BSLH01-X01"),
  cardNo: "TEST-ORACLE-CONDITIONS",
  grandwalkerData: {
    ...real("BSLH01-X01").grandwalkerData!,
    oracleConditions: [{ categories: ["spirit"] }],
    oracleTriggerKinds: ["summon"],
  },
  effects: [],
};
const stone: CardDefinition = {
  ...real("BSTH06-転醒X01(A)"),
  cardNo: "TEST-UNSEAL-CONDITIONS",
  grandstoneData: {
    ...real("BSTH06-転醒X01(A)").grandstoneData!,
    unsealConditions: [
      { events: ["summon"], cardFilter: { categories: ["spirit"] } },
    ],
  },
  effects: [],
};
const spirit: CardDefinition = {
  cardNo: "TEST-CONDITION-SUBJECT",
  name: "条件主語",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 1,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  textLines: [],
  keywordTags: [],
};
function fixture(
  kind: "oracle" | "unseal" | "placement_oracle",
  resource = false,
  withPeer = true,
  purpleFilter = false
) {
  const sourceDef: CardDefinition =
    kind === "unseal"
      ? {
          ...stone,
          ...(purpleFilter
            ? {
                grandstoneData: {
                  ...stone.grandstoneData!,
                  unsealConditions: [
                    {
                      events: ["summon"],
                      cardFilter: {
                        categories: ["spirit"],
                        tribes: ["導魔"],
                      },
                    },
                  ],
                },
              }
            : {}),
        }
      : {
          ...oracle,
          ...(purpleFilter
            ? {
                grandwalkerData: {
                  ...oracle.grandwalkerData!,
                  oracleConditions: [
                    { categories: ["spirit"], colors: ["purple"] },
                  ],
                },
              }
            : {}),
        };
  const eventKind = kind === "placement_oracle" ? "place" : "summon";
  const peer: CardDefinition = {
    ...spirit,
    cardNo: "TEST-CONDITION-PEER",
    effects: [
      {
        timing: { kind: "game_event", event: eventKind, player: "self" },
        executionMode: "optional",
        steps: [
          {
            action: resource
              ? {
                  kind: "core_move",
                  from: { kind: "reserve", player: "self" },
                  to: { kind: "void", player: "self" },
                  amount: 1,
                }
              : { kind: "count_increase", player: "self", amount: 1 },
          },
        ],
      },
    ],
  };
  const defs = [sourceDef, spirit, peer];
  const deps = {
    getCardDefinitionById: (id: string) =>
      defs.find((def) => def.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  const make = (
    def: CardDefinition,
    id: string,
    zone: "field" | "deck" | "hand" | "trash"
  ) =>
    createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: "alice",
      zone,
      normalCoreCount:
        zone === "field" && def.printedCategory === "spirit" ? 1 : 0,
    });
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { voidNormalCoreCount: resource ? 0 : 20, reserveNormalCoreCount: 10 },
        {},
      ],
      cardInstances: [
        make(sourceDef, "source", "field"),
        make(spirit, "subject", "field"),
        make(sourceDef, "same-name", "hand"),
        ...[0, 1, 2].map((i) => make(spirit, `deck-${i}`, "deck")),
        ...(withPeer ? [make(peer, "peer", "field")] : []),
      ],
    }),
    step: "main",
  };
  function queue(current: GameState, observedState?: GameState) {
    const event: SupplementalTriggerEvent = {
      eventKind,
      source: "action_resolution",
      chainId: "native-condition-event",
      attackId: null,
      actingPlayerId: "alice",
      relatedPlayerId: "alice",
      relatedInstanceId: eventKind === "place" ? "source" : "subject",
      amount: null,
      observationSnapshot: captureTriggerObservation(current),
    };
    if (observedState)
      event.eventFactOccurrences = [
        captureTriggerEventFacts(
          observedState,
          event,
          deps.getCardDefinitionById
        ),
      ];
    return collectAndQueueTriggerReactions({
      beforeState: current,
      afterState: current,
      source: "action_resolution",
      chainId: event.chainId,
      supplementalEvents: [event],
      ...deps,
    });
  }
  return { state, deps, queue };
}
type Deps = ReturnType<typeof fixture>["deps"];
function pending(state: GameState, kind: TriggeredMechanic["kind"]) {
  return state.pendingTriggeredEffects.find((p) => p.mechanic?.kind === kind)!;
}
function legal(state: GameState, deps: Deps) {
  return ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
}
function act(
  state: GameState,
  deps: Deps,
  predicate: (a: LegalAction) => boolean,
  skipOptionalEffect = false
) {
  const all = legal(state, deps);
  const action = all.find(predicate);
  expect(action, JSON.stringify(all)).toBeDefined();
  return applyLegalAction({
    state,
    action: action!,
    skipOptionalEffect,
    ...deps,
  }).state;
}
function resolve(
  state: GameState,
  deps: Deps,
  kind: TriggeredMechanic["kind"] | "peer",
  skip = false
) {
  const target = kind === "peer" ? undefined : pending(state, kind)?.pendingId;
  state = act(
    state,
    deps,
    (a) =>
      (a.kind === "resolve_pending_triggered_effect" ||
        a.kind === "select_pending_to_resolve") &&
      (kind === "peer"
        ? a.sourceInstanceId === "peer"
        : a.pendingId === target),
    skip
  );
  for (let i = 0; state.stackWindow && i < 12; i++)
    state = act(state, deps, (a) => a.kind === "pass_stack");
  return state;
}
function available(
  state: GameState,
  deps: Deps,
  kind: TriggeredMechanic["kind"]
) {
  const p = pending(state, kind);
  return (
    !!p &&
    getTriggeredMechanicActivationState(
      state,
      p.mechanic!,
      deps.getCardDefinitionById
    ).canActivate
  );
}

describe("native同時誘発の動的条件と使用済み境界", () => {
  it("自己配置の導託は配置前の第三者観測一覧ではなく配置後の自個体から発揮する", () => {
    const f = fixture("placement_oracle");
    const before = moveCardZone(f.state, "source", "hand");
    const placed = moveCardZone(before, "source", "field");
    const event: SupplementalTriggerEvent = {
      eventKind: "place",
      source: "action_resolution",
      chainId: "own-placement",
      attackId: null,
      actingPlayerId: "alice",
      relatedPlayerId: "alice",
      relatedInstanceId: "source",
      amount: null,
      observationSnapshot: captureTriggerObservation(before),
    };
    event.eventFactOccurrences = [
      captureTriggerEventFacts(placed, event, f.deps.getCardDefinitionById),
    ];
    const state = resolve(
      queueFieldEntryOracleReactions(
        placed,
        [event],
        f.deps.getCardDefinitionById
      ),
      f.deps,
      "placement_oracle"
    );
    expect(
      state.cardInstances.filter(
        (c) => c.instanceId.startsWith("deck-") && c.zone === "trash"
      )
    ).toHaveLength(3);
  });
  it.each(["oracle", "unseal"] as const)(
    "%s: 事象後の色・系統の追加は誘発させず、事象時の一致は後で失っても保持する",
    (kind) => {
      const f = fixture(kind, false, true, true);
      const purple: GameState = {
        ...f.state,
        activeContinuousEffects: [
          {
            effectId: "purple-subject",
            sourceInstanceId: "peer",
            sourceDefinitionId: "TEST-CONDITION-PEER",
            actingPlayerId: "alice",
            targetInstanceId: "subject",
            ...(kind === "unseal"
              ? {
                  modifierTag: "override_properties" as const,
                  metadata: { properties: { addTribes: ["導魔"] } },
                }
              : {
                  modifierTag: "treat_as_color" as const,
                  modifierSymbol: ["purple"],
                }),
            duration: { scope: "turn" },
            createdAtTurn: f.state.turnNumber,
            createdAtAttackId: null,
          },
        ],
      };
      expect(pending(f.queue(purple, f.state), kind)).toBeUndefined();
      const state = resolve(f.queue(f.state, purple), f.deps, kind);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(1);
    }
  );
  it.each(["oracle", "unseal"] as const)(
    "%s: ボイド0でも観測を保持し、同群のコア返却後に発揮できる",
    (kind) => {
      const f = fixture(kind, true);
      let state = f.queue(f.state);
      expect(pending(state, kind).dormantMechanic).toBe(true);
      expect(available(state, f.deps, kind)).toBe(false);
      const beforeResource = state;
      state = resolve(state, f.deps, "peer");
      expect(available(state, f.deps, kind)).toBe(true);
      expect(
        isTriggeredMechanicExplicitConditionNewlyEnabled(
          beforeResource,
          state,
          pending(beforeResource, kind),
          pending(state, kind),
          f.deps.getCardDefinitionById
        )
      ).toBe(false);
      state = resolve(JSON.parse(JSON.stringify(state)), f.deps, kind);
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(1);
      expect(state.players[0]?.voidNormalCoreCount).toBe(0);
    }
  );
  it.each(["oracle", "unseal", "placement_oracle"] as const)(
    "%s: 抑止中は本文を観測せず、後の抑止解除でも過去の事象を復活させない",
    (kind) => {
      const f = fixture(kind);
      const suppressed: GameState = {
        ...f.state,
        activeContinuousEffects: [
          {
            effectId: "suppress",
            sourceInstanceId: "peer",
            sourceDefinitionId: "TEST-CONDITION-PEER",
            actingPlayerId: "alice",
            targetInstanceId: "source",
            modifierTag: "effect_suppression",
            duration: { scope: "turn" },
            createdAtTurn: f.state.turnNumber,
            createdAtAttackId: null,
            metadata: {},
          },
        ],
      };
      let state = f.queue(suppressed);
      expect(pending(state, kind)).toBeUndefined();
      // A later step removed suppression before the deferred collector ran.
      expect(pending(f.queue(f.state, suppressed), kind)).toBeUndefined();
      state = { ...state, activeContinuousEffects: [] };
      state = pruneIllegalPendingTriggeredEffects({ state, ...f.deps });
      expect(pending(state, kind)).toBeUndefined();
    }
  );
  it.each(["same-name", "empty-deck"] as const)(
    "配置時神託 %s 条件が同群中に変化すると発揮できる",
    (condition) => {
      const f = fixture("placement_oracle");
      let state =
        condition === "same-name"
          ? moveCardZone(f.state, "same-name", "field")
          : f.state;
      if (condition === "empty-deck")
        for (let i = 0; i < 3; i++)
          state = moveCardZone(state, `deck-${i}`, "trash");
      state = f.queue(state);
      expect(pending(state, "placement_oracle")?.dormantMechanic).toBe(true);
      expect(available(state, f.deps, "placement_oracle")).toBe(false);
      const beforeCondition = state;
      expect(
        pending(state, "placement_oracle").dormantMechanicCondition === true
      ).toBe(condition === "same-name");
      state =
        condition === "same-name"
          ? moveCardZone(state, "same-name", "hand")
          : moveCardZone(state, "deck-0", "deck");
      expect(available(state, f.deps, "placement_oracle")).toBe(true);
      expect(
        isTriggeredMechanicExplicitConditionNewlyEnabled(
          beforeCondition,
          state,
          pending(beforeCondition, "placement_oracle"),
          pending(state, "placement_oracle"),
          f.deps.getCardDefinitionById
        )
      ).toBe(condition === "same-name");
      state = resolve(state, f.deps, "placement_oracle");
      expect(
        state.cardInstances.find((c) => c.instanceId === "deck-0")?.zone
      ).toBe("trash");
      expect(
        state.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(condition === "same-name" ? 3 : 1);
    }
  );
  it.each(["oracle", "unseal"] as const)(
    "%s: 兄弟を辞退した空群は閉じ、後の資源増加で復活しない",
    (kind) => {
      const f = fixture(kind, true);
      let state = resolve(f.queue(f.state), f.deps, "peer", true);
      expect(pending(state, kind)).toBeUndefined();
      state = moveNormalCores(
        state,
        { kind: "reserve", playerId: "alice" },
        { kind: "void", playerId: "alice" },
        1
      );
      expect(pending(state, kind)).toBeUndefined();
      const alone = fixture(kind, true, false);
      expect(alone.queue(alone.state).pendingTriggeredEffects).toHaveLength(0);
    }
  );
  it("使用済み神託は資源不足の未成立候補として保存しない", () => {
    const f = fixture("oracle", true);
    const used = seedOracleTriggerUsage(
      f.state,
      "source",
      "summon",
      f.deps.getCardDefinitionById
    );
    expect(pending(f.queue(used), "oracle")).toBeUndefined();
  });
  it("一度成立した配置時神託が同名出現で失効した後は、同名除去でも復活しない", () => {
    const f = fixture("placement_oracle");
    let state = f.queue(f.state);
    expect(available(state, f.deps, "placement_oracle")).toBe(true);
    state = pruneIllegalPendingTriggeredEffects({
      state: moveCardZone(state, "same-name", "field"),
      ...f.deps,
    });
    expect(pending(state, "placement_oracle")).toBeUndefined();
    state = moveCardZone(state, "same-name", "hand");
    expect(pending(state, "placement_oracle")).toBeUndefined();
  });
  it("配置時神託を宣言した後の同名配置は、宣言済みのデッキ破棄を止めない", () => {
    const f = fixture("placement_oracle");
    let state = f.queue(f.state);
    const target = pending(state, "placement_oracle").pendingId;
    state = act(
      state,
      f.deps,
      (a) =>
        a.pendingId === target &&
        (a.kind === "resolve_pending_triggered_effect" ||
          a.kind === "select_pending_to_resolve")
    );
    expect(state.stackWindow).not.toBeNull();
    state = moveCardZone(state, "same-name", "field");
    for (let i = 0; state.stackWindow && i < 12; i++)
      state = act(state, f.deps, (a) => a.kind === "pass_stack");
    expect(state.stackWindow).toBeNull();
    expect(
      state.cardInstances.filter(
        (c) => c.instanceId.startsWith("deck-") && c.zone === "trash"
      )
    ).toHaveLength(3);
    expect(
      state.cardInstances.find((c) => c.instanceId === "source")
        ?.normalCoreCount
    ).toBe(3);
  });
  it("通常イベントがない同一コア配置でも複数石の転醒を同群にし、未成立候補を失わない", () => {
    const f = fixture("unseal");
    const threshold = stone.grandstoneData!.rebirthCoreThreshold!;
    const partner: CardDefinition = {
      ...stone,
      cardNo: "TEST-UNRESTRICTED-STONE",
      grandstoneData: { ...stone.grandstoneData!, rebirthMaxCount: 100 },
    };
    const deps = {
      ...f.deps,
      getCardDefinitionById: (id: string) =>
        id === partner.cardNo ? partner : f.deps.getCardDefinitionById(id),
    };
    const before: GameState = {
      ...f.state,
      players: f.state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              countValue: (stone.grandstoneData!.rebirthMaxCount ?? 3) + 1,
            }
          : p
      ),
      cardInstances: [
        ...f.state.cardInstances.map((c) =>
          c.instanceId === "source"
            ? { ...c, normalCoreCount: threshold - 1 }
            : c
        ),
        createCardInstance(partner, {
          instanceId: "partner",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: threshold - 1,
        }),
      ],
    };
    let after = moveNormalCores(
      before,
      { kind: "void", playerId: "alice" },
      { kind: "card", instanceId: "source" },
      1
    );
    after = moveNormalCores(
      after,
      { kind: "void", playerId: "alice" },
      { kind: "card", instanceId: "partner" },
      1
    );
    let state = collectAndQueueTriggerReactions({
      beforeState: before,
      afterState: after,
      source: "action_resolution",
      chainId: "two-stone-cores",
      ...deps,
    });
    const stones = state.pendingTriggeredEffects.filter(
      (p) => p.mechanic?.kind === "stone_rebirth"
    );
    expect(stones).toHaveLength(2);
    expect(stones[0]!.simultaneousGroupId).toBeDefined();
    expect(stones[0]!.simultaneousGroupId).toBe(stones[1]!.simultaneousGroupId);
    expect(
      stones.find((p) => p.relatedInstanceId === "source")?.dormantMechanic
    ).toBe(true);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 0 } : p
      ),
    };
    state = pruneIllegalPendingTriggeredEffects({ state, ...deps });
    expect(
      state.pendingTriggeredEffects.find(
        (p) => p.relatedInstanceId === "source"
      )?.dormantMechanic
    ).toBe(false);
    expect(
      legal(state, deps).some(
        (a) =>
          a.pendingId ===
          stones.find((p) => p.relatedInstanceId === "source")!.pendingId
      )
    ).toBe(true);
  });
  it("創界石転醒は閾値到達事象を固定し、カウント条件だけ再評価する", () => {
    const f = fixture("unseal");
    const threshold = stone.grandstoneData!.rebirthCoreThreshold!;
    let before = {
      ...f.state,
      players: f.state.players.map((p) =>
        p.id === "alice"
          ? {
              ...p,
              countValue: (stone.grandstoneData!.rebirthMaxCount ?? 3) + 1,
            }
          : p
      ),
    };
    before = {
      ...before,
      cardInstances: before.cardInstances.map((c) =>
        c.instanceId === "source" ? { ...c, normalCoreCount: threshold - 1 } : c
      ),
    };
    const after = moveNormalCores(
      before,
      { kind: "void", playerId: "alice" },
      { kind: "card", instanceId: "source" },
      1
    );
    let state = checkAndQueueStoneRebirthChoices(
      before,
      after,
      f.deps.getCardDefinitionById,
      "native-condition-event",
      { captureDynamicEligibility: true }
    );
    expect(pending(state, "stone_rebirth")?.dormantMechanic).toBe(true);
    expect(available(state, f.deps, "stone_rebirth")).toBe(false);
    const beforeCount = state;
    expect(pending(state, "stone_rebirth").dormantMechanicCondition).toBe(true);
    state = {
      ...state,
      players: state.players.map((p) =>
        p.id === "alice" ? { ...p, countValue: 0 } : p
      ),
    };
    expect(available(state, f.deps, "stone_rebirth")).toBe(true);
    expect(
      isTriggeredMechanicExplicitConditionNewlyEnabled(
        beforeCount,
        state,
        pending(beforeCount, "stone_rebirth"),
        pending(state, "stone_rebirth"),
        f.deps.getCardDefinitionById
      )
    ).toBe(true);
    const legacy = { ...pending(beforeCount, "stone_rebirth") };
    delete legacy.dormantMechanicCondition;
    expect(
      isTriggeredMechanicExplicitConditionNewlyEnabled(
        beforeCount,
        state,
        legacy,
        pending(state, "stone_rebirth"),
        f.deps.getCardDefinitionById
      )
    ).toBe(false);
    const notAtThreshold = checkAndQueueStoneRebirthChoices(
      before,
      before,
      f.deps.getCardDefinitionById,
      "later",
      { captureDynamicEligibility: true }
    );
    expect(pending(notAtThreshold, "stone_rebirth")).toBeUndefined();
  });
});
