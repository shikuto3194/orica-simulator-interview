import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  type CardColor,
  type CardDefinition,
  type ContinuousEffect,
  type GameState,
  type OracleTriggerKind,
} from "../src/runtime";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
} from "../src/mechanics/oracle-system";

type Target = {
  category: CardDefinition["printedCategory"];
  colors: CardColor[];
  tribe?: string;
};
const black = (category: Target["category"]): Target => ({
  category,
  colors: ["black"],
});
// Transcribed from the printed OR branches, independently of grandwalkerData.
const profiles: {
  no: string;
  events: OracleTriggerKind[];
  hits: Target[];
  misses: Target[];
}[] = [
  {
    no: "BSTH10-X01",
    events: ["summon", "advent", "place"],
    hits: [black("spirit"), black("ultimate"), black("nexus")],
    misses: [
      { category: "spirit", colors: ["red"] },
      { category: "ultimate", colors: ["black", "red"] },
      { category: "nexus", colors: [] },
      black("brave"),
      black("magic"),
    ],
  },
  ...["BSTH10-X03", "BSTH10-X04"].map((no) => ({
    no,
    events: ["summon", "advent"] as OracleTriggerKind[],
    hits: [
      black("spirit"),
      black("ultimate"),
      {
        category: "ultimate" as const,
        colors: ["red" as const],
        tribe: "月人",
      },
      {
        category: "ultimate" as const,
        colors: ["black" as const, "red" as const],
        tribe: "月人",
      },
      { ...black("ultimate"), tribe: "月人" },
    ],
    misses: [
      { category: "spirit" as const, colors: ["red" as const], tribe: "月人" },
      {
        category: "ultimate" as const,
        colors: ["black" as const, "red" as const],
      },
      {
        category: "ultimate" as const,
        colors: ["red" as const],
        tribe: "非対象",
      },
      black("nexus"),
      { ...black("brave"), tribe: "月人" },
      black("magic"),
    ],
  })),
];

function fixture(no: string, target: Target, deck = false, owner = "alice") {
  const definition = ALL_CARDS.find((c) => c.cardNo === no)!;
  const trigger: CardDefinition = {
    cardNo: "TEST-COLOR-ORACLE-TARGET",
    name: "印字神託条件の対象",
    printedCategory: target.category,
    colors: target.colors,
    cost: 0,
    tribe: target.tribe ?? "非対象",
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    keywordTags: [],
    textLines: [],
  };
  const miss: CardDefinition = {
    ...trigger,
    cardNo: "TEST-COLOR-ORACLE-MISS",
    printedCategory: "magic",
    tribe: "非対象",
  };
  const lookup = (id: string) =>
    id === trigger.cardNo
      ? trigger
      : id === miss.cardNo
        ? miss
        : ALL_CARDS.find((c) => c.cardNo === id);
  const make = (
    id: string,
    def: CardDefinition,
    zone: "field" | "deck",
    cardOwner = "alice"
  ) =>
    createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: cardOwner,
      controllerPlayerId: cardOwner,
      zone,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make("source", definition, "field"),
      make("target", trigger, deck ? "deck" : "field", owner),
      ...(deck
        ? [
            make("hit2", trigger, "deck"),
            make("miss", miss, "deck"),
            make("fourth", trigger, "deck"),
          ]
        : []),
    ],
    playerOverrides: [
      { voidNormalCoreCount: 20, deckCount: deck ? 4 : 0 },
      { voidNormalCoreCount: 20 },
    ],
  });
  return { state, lookup, make, definition };
}

function resolve(
  state: GameState,
  lookup: (id: string) => CardDefinition | undefined,
  accept = true
) {
  const pending = state.pendingTriggeredEffects.find(
    (p) =>
      p.mechanic?.kind === "oracle" || p.mechanic?.kind === "placement_oracle"
  )!;
  expect(pending).toBeDefined();
  const action = getLegalActions({
    state,
    actingPlayerId: "alice",
    getCardDefinitionById: lookup,
  }).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.pendingId === pending.pendingId
  );
  expect(action).toBeDefined();
  let after = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    ...(!accept ? { skipOptionalEffect: true } : {}),
  }).state;
  // Declaration opens the response window; it does not move the oracle core yet.
  expect(
    after.cardInstances.find((c) => c.instanceId === "source")?.normalCoreCount
  ).toBe(0);
  if (accept) {
    expect(after.stackWindow).not.toBeNull();
    if (pending.mechanic?.kind === "placement_oracle") {
      expect(after.players[0]!.deckCount).toBe(state.players[0]!.deckCount);
      expect(
        after.cardInstances.filter((c) => c.zone === "trash")
      ).toHaveLength(0);
    }
    for (let i = 0; after.stackWindow && i < 10; i++) {
      const pass = getLegalActions({
        state: after,
        actingPlayerId: after.stackWindow.priorityPlayerId,
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      after = applyLegalAction({
        state: after,
        action: pass!,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
  }
  expect(after.stackWindow).toBeNull();
  expect(after.pendingTriggeredEffects).toHaveLength(0);
  return after;
}

function extraColor(): ContinuousEffect {
  return {
    effectId: "color-oracle-add-red",
    sourceInstanceId: "target",
    sourceDefinitionId: "TEST-COLOR-ORACLE-TARGET",
    actingPlayerId: "alice",
    targetInstanceId: "target",
    modifierTag: "treat_as_color",
    modifierSymbol: ["red"],
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
  };
}

describe("黒1色と月人の印字神託", () => {
  for (const profile of profiles) {
    it(`${profile.no} printed_oracle: 黒単色と月人のOR・受諾/辞退・実効色・非対象イベントを最終盤面で確認`, () => {
      for (const target of profile.hits) {
        for (const event of profile.events) {
          for (const accept of [true, false]) {
            const f = fixture(profile.no, target);
            const queued = checkAndQueueOracleChoices(
              f.state,
              "target",
              event,
              f.lookup,
              `test:color-oracle:${event}`
            );
            expect(
              queued.pendingTriggeredEffects.filter(
                (p) => p.mechanic?.kind === "oracle"
              )
            ).toHaveLength(1);
            const after = resolve(queued, f.lookup, accept);
            expect(
              after.cardInstances.find((c) => c.instanceId === "source")
                ?.normalCoreCount
            ).toBe(accept ? 1 : 0);
            expect(after.players[0]!.voidNormalCoreCount).toBe(
              accept ? 19 : 20
            );
          }
        }
      }
      for (const target of profile.misses) {
        for (const event of profile.events) {
          const f = fixture(profile.no, target);
          const after = checkAndQueueOracleChoices(
            f.state,
            "target",
            event,
            f.lookup,
            "test:color-oracle:miss"
          );
          expect(after.pendingTriggeredEffects).toHaveLength(0);
          expect(
            after.cardInstances.find((c) => c.instanceId === "source")
              ?.normalCoreCount
          ).toBe(0);
          expect(after.players[0]!.voidNormalCoreCount).toBe(20);
        }
      }
      for (const event of [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as OracleTriggerKind[]) {
        if (!profile.events.includes(event)) {
          const f = fixture(profile.no, profile.hits[0]!);
          expect(
            checkAndQueueOracleChoices(
              f.state,
              "target",
              event,
              f.lookup,
              "test:color-oracle:event"
            ).pendingTriggeredEffects
          ).toHaveLength(0);
        }
      }
      const enemy = fixture(profile.no, profile.hits[0]!, false, "bob");
      expect(
        checkAndQueueOracleChoices(
          enemy.state,
          "target",
          "summon",
          enemy.lookup,
          "test:color-oracle:opponent"
        ).pendingTriggeredEffects
      ).toHaveLength(0);
      // Printed black alone stops matching when a continuous effect adds red.
      const colored = fixture(profile.no, black("spirit"));
      const multi = {
        ...colored.state,
        activeContinuousEffects: [extraColor()],
      };
      expect(
        checkAndQueueOracleChoices(
          multi,
          "target",
          "summon",
          colored.lookup,
          "test:color-oracle:multicolor"
        ).pendingTriggeredEffects
      ).toHaveLength(0);
      if (profile.no !== "BSTH10-X01") {
        const moon = fixture(profile.no, {
          ...black("ultimate"),
          tribe: "月人",
        });
        const queued = checkAndQueueOracleChoices(
          { ...moon.state, activeContinuousEffects: [extraColor()] },
          "target",
          "summon",
          moon.lookup,
          "test:color-oracle:moon"
        );
        const after = resolve(queued, moon.lookup);
        expect(
          after.cardInstances.find((c) => c.instanceId === "source")
            ?.normalCoreCount
        ).toBe(1);
      }
    });

    it(`${profile.no} printed_placement_oracle: 全OR枝と黒多色を上3枚の直接トラッシュ・コア数・同名条件で確認`, () => {
      for (const target of profile.hits) {
        const f = fixture(profile.no, target, true);
        for (const accept of [true, false]) {
          const queued = checkAndQueuePlacementOracle(
            f.state,
            "source",
            f.lookup,
            "test:color-placement"
          );
          const after = resolve(queued, f.lookup, accept);
          expect(
            after.cardInstances
              .filter((c) => c.zone === "trash")
              .map((c) => c.instanceId)
          ).toEqual(accept ? ["target", "hit2", "miss"] : []);
          expect(
            after.cardInstances.find((c) => c.instanceId === "fourth")?.zone
          ).toBe("deck");
          expect(
            after.cardInstances.find((c) => c.instanceId === "source")
              ?.normalCoreCount
          ).toBe(accept ? 2 : 0);
          expect(after.players[0]!.deckCount).toBe(accept ? 1 : 4);
          expect(after.players[0]!.voidNormalCoreCount).toBe(accept ? 18 : 20);
        }
      }
      for (const target of profile.misses) {
        const f = fixture(profile.no, target, true);
        const after = resolve(
          checkAndQueuePlacementOracle(
            f.state,
            "source",
            f.lookup,
            "test:color-placement:miss"
          ),
          f.lookup
        );
        expect(after.players[0]!.deckCount).toBe(1);
        expect(
          after.cardInstances.filter((c) => c.zone === "trash")
        ).toHaveLength(3);
        expect(
          after.cardInstances.find((c) => c.instanceId === "source")
            ?.normalCoreCount
        ).toBe(0);
        expect(after.players[0]!.voidNormalCoreCount).toBe(20);
      }
      const f = fixture(profile.no, profile.hits[0]!, true);
      for (const owner of ["alice", "bob"]) {
        const state = {
          ...f.state,
          cardInstances: [
            ...f.state.cardInstances,
            f.make("sibling", f.definition, "field", owner),
          ],
        };
        const queued = checkAndQueuePlacementOracle(
          state,
          "source",
          f.lookup,
          "test:color-placement:sibling"
        );
        expect(queued.pendingTriggeredEffects).toHaveLength(
          owner === "alice" ? 0 : 1
        );
        if (owner === "bob") {
          const after = resolve(queued, f.lookup);
          expect(
            after.cardInstances.find((c) => c.instanceId === "source")
              ?.normalCoreCount
          ).toBe(2);
          expect(
            after.cardInstances.find((c) => c.instanceId === "sibling")
              ?.normalCoreCount
          ).toBe(0);
        }
      }
      const short = {
        ...f.state,
        cardInstances: f.state.cardInstances.filter((c) =>
          ["source", "target"].includes(c.instanceId)
        ),
        players: f.state.players.map((p) =>
          p.id === "alice" ? { ...p, deckCount: 1 } : p
        ),
      };
      const after = resolve(
        checkAndQueuePlacementOracle(
          short,
          "source",
          f.lookup,
          "test:color-placement:short"
        ),
        f.lookup
      );
      expect(after.players[0]!.deckCount).toBe(0);
      expect(
        after.cardInstances.find((c) => c.instanceId === "target")?.zone
      ).toBe("trash");
      expect(
        after.cardInstances.find((c) => c.instanceId === "source")
          ?.normalCoreCount
      ).toBe(1);
      expect(after.players[0]!.voidNormalCoreCount).toBe(19);
    });
  }
});
