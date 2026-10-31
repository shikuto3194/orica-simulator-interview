import { describe, expect, it } from "vitest";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";

const makeDef = (
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition => ({
  cardNo,
  name: cardNo,
  printedCategory: "spirit",
  colors: ["red"],
  cost: 5,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
  ...overrides,
});

function reveal(
  kind: "grandwalker" | "guided" | "grandstone",
  copies = 1,
  explicit = false
) {
  const host = makeDef("HOST", {
    printedCategory: "nexus",
    levelDefs: [{ level: 1, requiredCores: 0 }],
    ...(kind === "grandstone"
      ? { grandstoneData: { unsealConditions: [] } }
      : {
          grandwalkerData: {
            kind,
            oracleConditions: [],
            oracleTriggerKinds: ["summon"],
          },
        }),
  });
  const brave = makeDef("BRAVE", {
    printedCategory: "brave",
    braveCondition: { categories: ["nexus"], targetsGrandwalker: true },
    effects: [
      {
        timing: { kind: "card_event", event: "summon" },
        steps: [{ action: { kind: "draw", count: 1 } }],
      },
    ],
  });
  const source = makeDef("SOURCE", {
    effects: [
      {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "deck_reveal",
              revealCount: copies + 1,
              picks: [
                {
                  filter: { category: ["brave"] },
                  count: copies,
                  destination: "field",
                },
              ],
              remainder: "trash",
            },
          },
          ...(explicit
            ? [
                {
                  action: {
                    kind: "core_distribute" as const,
                    from: { kind: "reserve" as const, player: "self" as const },
                    to: {
                      kind: "filter" as const,
                      player: "self" as const,
                      filter: {
                        category: ["nexus" as const],
                        targetsGrandwalker: "only" as const,
                      },
                      count: "all" as const,
                    },
                    amount: 1,
                    minTotal: 1,
                    mode: "player_choice" as const,
                  },
                },
              ]
            : []),
        ],
      },
    ],
  });
  const defs = [source, host, brave];
  const lookup = (id: string) => defs.find((def) => def.cardNo === id);
  const getRegisteredTriggeredEffectActions = buildTriggeredEffectLookup(defs);
  const legal = (state: GameState) =>
    getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    });
  const apply = (
    state: GameState,
    action: ReturnType<typeof legal>[number],
    extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
  ) =>
    applyLegalAction({
      state,
      action,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      ...extra,
    }).state;
  const before = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { id: "alice", reserveNormalCoreCount: 4, deckCount: copies + 1 },
      ],
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(host, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        ...Array.from({ length: copies }, (_, i) =>
          createCardInstance(brave, {
            instanceId: `brave-${i}`,
            ownerPlayerId: "alice",
            zone: "deck",
          })
        ),
        createCardInstance(source, {
          instanceId: "remainder",
          ownerPlayerId: "alice",
          zone: "deck",
        }),
      ],
    }),
    activePlayerId: "alice",
    step: "main" as const,
  };
  const opened = executeEffect({
    state: before,
    chainId: "test:independent-brave",
    effect: source.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "source",
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions,
  });
  const pick = legal(opened).find(
    (action) => action.kind === "resolve_pending_deck_reveal_pick"
  )!;
  const state = apply(opened, pick, {
    selectedDeckRevealCardIds: Array.from(
      { length: copies },
      (_, i) => `brave-${i}`
    ),
  });
  const choose = (state: GameState, hostId: string | null) => {
    const action = legal(state).find(
      (action) =>
        action.kind === "resolve_brave_combine_choice" &&
        action.chosenHostInstanceId === hostId
    );
    expect(action).toBeDefined();
    return apply(state, action!);
  };
  return { state, choose, legal, apply };
}

describe("創界神系への効果召喚ブレイヴの直接合体", () => {
  it.each(["grandwalker", "guided", "grandstone"] as const)(
    "%sには通常の配置HUDを挟まず合体・残札・誘発を確定する",
    (kind) => {
      const fixture = reveal(kind);
      const final = fixture.choose(fixture.state, "host");
      expect(final.pendingMultiPlacement).toBeNull();
      expect(final.pendingBraveCombineChoice).toBeNull();
      expect(final.pendingDeckReveal).toBeNull();
      expect(
        final.cardInstances.find((card) => card.instanceId === "brave-0")
      ).toMatchObject({
        zone: "field",
        attachedToInstanceId: "host",
        normalCoreCount: 0,
      });
      expect(
        final.cardInstances.find((card) => card.instanceId === "host")
          ?.normalCoreCount
      ).toBe(2);
      expect(final.players[0]!.reserveNormalCoreCount).toBe(4);
      expect(
        final.cardInstances.find((card) => card.instanceId === "remainder")
          ?.zone
      ).toBe("trash");
      expect(
        final.pendingTriggeredEffects.filter(
          (pending) =>
            pending.eventKind === "summon" &&
            pending.relatedInstanceId === "brave-0"
        )
      ).toHaveLength(1);
    }
  );

  it("明示的な創界神への後続コア配置効果は別のHUDで解決できる", () => {
    const fixture = reveal("grandwalker", 1, true);
    const combined = fixture.choose(fixture.state, "host");
    expect(combined.pendingMultiPlacement).toBeNull();
    expect(combined.pendingCoreDistribution).not.toBeNull();
    const action = fixture
      .legal(combined)
      .find((action) => action.kind === "resolve_pending_core_distribution")!;
    const final = fixture.apply(combined, action, {
      coreDistributionAllocations: { host: 1 },
    });
    expect(
      final.cardInstances.find((card) => card.instanceId === "host")
        ?.normalCoreCount
    ).toBe(3);
    expect(final.players[0]!.reserveNormalCoreCount).toBe(3);
    expect(final.pendingCoreDistribution).toBeNull();
  });

  it("創界神との合体を断った場合はブレイヴ自身の維持コアを配置する", () => {
    const fixture = reveal("grandwalker");
    const declined = fixture.choose(fixture.state, null);
    const action = fixture
      .legal(declined)
      .find((entry) => entry.kind === "resolve_pending_multi_placement")!;
    expect(action).toBeDefined();
    const final = fixture.apply(declined, action, {
      multiPlacementAllocations: [
        {
          destinationInstanceId: "brave-0",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });
    expect(final.pendingMultiPlacement).toBeNull();
    expect(final.pendingDeckReveal).toBeNull();
    expect(
      final.cardInstances.find((card) => card.instanceId === "brave-0")
    ).toMatchObject({ attachedToInstanceId: null, normalCoreCount: 1 });
    expect(
      final.cardInstances.find((card) => card.instanceId === "host")
        ?.normalCoreCount
    ).toBe(2);
    expect(final.players[0]!.reserveNormalCoreCount).toBe(3);
  });

  it("複数枚では創界神に合体した分だけ配置先から外し、スピリット状態の配置を残す", () => {
    const fixture = reveal("grandwalker", 2);
    const first = fixture.choose(fixture.state, "host");
    expect(
      first.pendingMultiPlacement?.targets.map((target) => target.instanceId)
    ).toEqual(["brave-1"]);
    const action = fixture
      .legal(first)
      .find((action) => action.kind === "resolve_pending_multi_placement")!;
    expect(action).toBeDefined();
    expect(() =>
      fixture.apply(first, action, {
        multiPlacementAllocations: [
          {
            destinationInstanceId: "brave-0",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
          {
            destinationInstanceId: "brave-1",
            placements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
      })
    ).toThrow("not in pending.targets");
    const final = fixture.apply(first, action, {
      multiPlacementAllocations: [
        {
          destinationInstanceId: "brave-1",
          placements: [{ kind: "reserve_normal", amount: 1 }],
        },
      ],
    });
    expect(final.pendingMultiPlacement).toBeNull();
    expect(final.pendingDeckReveal).toBeNull();
    expect(
      final.cardInstances.find((card) => card.instanceId === "host")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      final.cardInstances.find((card) => card.instanceId === "brave-1")
    ).toMatchObject({ attachedToInstanceId: null, normalCoreCount: 1 });
    expect(
      final.pendingTriggeredEffects.filter(
        (pending) => pending.eventKind === "summon"
      )
    ).toHaveLength(2);
  });
});
