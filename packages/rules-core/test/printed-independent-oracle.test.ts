import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  checkAndQueueOracleChoices,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  type CardDefinition,
  type GameState,
  type OracleTriggerKind,
} from "../src/runtime";

const ryujin = ALL_CARDS.find((c) => c.cardNo === "BSTH05.5-XX01")!;
const okina = ALL_CARDS.find((c) => c.cardNo === "BSTH11-X01")!;
function target(
  category: CardDefinition["printedCategory"],
  tribe: string,
  guided = false
): CardDefinition {
  return {
    cardNo: `TEST-INDEPENDENT-${category}-${tribe}-${guided}`,
    name: `${category}-${tribe}`,
    printedCategory: category,
    colors: ["red"],
    cost: 0,
    tribe,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    keywordTags: [],
    textLines: [],
    ...(guided
      ? {
          grandwalkerData: {
            kind: "guided",
            oracleTriggerKinds: ["summon"] as const,
            oracleConditions: [],
          } as const,
        }
      : {}),
  };
}
function fixture(
  source: CardDefinition,
  targets: CardDefinition[],
  placement = false,
  siblingOwner?: string,
  targetOwner = "alice"
) {
  const definitions = [source, ...targets];
  const lookup = (id: string) => definitions.find((c) => c.cardNo === id);
  const triggers = buildTriggeredEffectLookup(definitions);
  const make = (
    def: CardDefinition,
    id: string,
    zone: "field" | "deck" | "hand",
    owner = "alice"
  ) =>
    createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone,
    });
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make(source, "source", placement ? "hand" : "field"),
      ...targets.map((def, i) =>
        make(def, `target-${i}`, placement ? "deck" : "field", targetOwner)
      ),
      ...(siblingOwner ? [make(source, "sibling", "field", siblingOwner)] : []),
    ],
    playerOverrides: [
      {
        reserveNormalCoreCount: 10,
        voidNormalCoreCount: 20,
        deckCount: targets.length,
      },
      { reserveNormalCoreCount: 10, voidNormalCoreCount: 20 },
    ],
  });
  const state: GameState = { ...base, step: "main", window: "none" };
  function actions(current: GameState, player = "alice") {
    return getLegalActions({
      state: current,
      actingPlayerId: player,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggers,
      getRegisteredFieldCardEffectActions: () => [],
    });
  }
  function apply(
    current: GameState,
    action: ReturnType<typeof actions>[number],
    skipOptionalEffect = false
  ) {
    return applyLegalAction({
      state: current,
      action,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggers,
      getRegisteredFieldCardEffectActions: () => [],
      skipOptionalEffect,
      ...(action.kind === "place_nexus"
        ? {
            paymentSources: [
              { kind: "reserve" as const, amount: action.finalCost },
            ],
          }
        : {}),
    }).state;
  }
  function close(current: GameState) {
    for (let i = 0; current.stackWindow && i < 12; i++) {
      const pass = actions(current, current.stackWindow.priorityPlayerId).find(
        (a) => a.kind === "pass_stack"
      );
      expect(pass).toBeDefined();
      current = apply(current, pass!);
    }
    expect(current.stackWindow).toBeNull();
    return current;
  }
  function resolve(current: GameState, skip = false) {
    for (let i = 0; i < 12; i++) {
      const burst = actions(current).find(
        (a) => a.kind === "resolve_pending_burst_check"
      );
      if (!burst) break;
      current = apply(current, burst);
    }
    const pending = current.pendingTriggeredEffects[0]!;
    expect(pending).toBeDefined();
    const select = actions(current).find(
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.pendingId === pending.pendingId
    );
    if (select) current = apply(current, select);
    const action = actions(current).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === pending.pendingId
    )!;
    expect(action).toBeDefined();
    const declared = apply(current, action, skip);
    return { declared, after: close(declared), action };
  }
  return { state, lookup, actions, apply, close, resolve };
}

describe("独立した通常神託と配置時神託", () => {
  it("BSTH05.5-XX01 printed_normal_oracle: 4系統のアルティメットと導界者ネクサスだけを印字イベントで受諾/辞退する", () => {
    const hits = [
      ...["竜渡", "博麗", "賢者", "幻想"].map((tribe) =>
        target("ultimate", tribe)
      ),
      target("nexus", "異系統", true),
    ];
    const misses = [
      target("spirit", "幻想"),
      target("ultimate", "異系統"),
      target("nexus", "幻想"),
      target("brave", "博麗"),
      target("spirit", "異系統", true),
      target("ultimate", "異系統", true),
    ];
    const events: OracleTriggerKind[] = [
      "summon",
      "advent",
      "place",
      "use_magic",
      "use_accel",
    ];
    for (const def of [...hits, ...misses]) {
      for (const event of events) {
        for (const owner of ["alice", "bob"]) {
          for (const accept of [true, false]) {
            const f = fixture(ryujin, [def], false, undefined, owner);
            const queued = checkAndQueueOracleChoices(
              f.state,
              "target-0",
              event,
              f.lookup,
              `printed:${event}`
            );
            const shouldQueue =
              hits.includes(def) &&
              events.indexOf(event) < 3 &&
              owner === "alice";
            expect(queued.pendingTriggeredEffects).toHaveLength(
              shouldQueue ? 1 : 0
            );
            if (!shouldQueue) {
              expect(
                queued.cardInstances.find((c) => c.instanceId === "source")!
                  .normalCoreCount
              ).toBe(0);
              continue;
            }
            const { declared, after } = f.resolve(queued, !accept);
            expect(declared.stackWindow !== null).toBe(accept);
            expect(
              declared.cardInstances.find((c) => c.instanceId === "source")!
                .normalCoreCount
            ).toBe(0);
            expect(
              after.cardInstances.find((c) => c.instanceId === "source")!
                .normalCoreCount
            ).toBe(accept ? 1 : 0);
            expect(after.players[0]!.voidNormalCoreCount).toBe(
              accept ? 19 : 20
            );
            expect(after.pendingTriggeredEffects).toHaveLength(0);
          }
        }
      }
    }
  });

  it("BSTH11-X01 printed_placement_oracle: 受諾時だけ上3枚を直接トラッシュへ置き天璋スピリットを数え、辞退と同名条件を守る", () => {
    const hit = target("spirit", "天璋");
    const miss = target("nexus", "天璋");
    for (const size of [1, 2, 4]) {
      for (const siblingOwner of [undefined, "alice", "bob"]) {
        for (const accept of [true, false]) {
          const deck = [hit, miss, hit, hit].slice(0, size);
          const f = fixture(okina, deck, true, siblingOwner);
          const place = f
            .actions(f.state)
            .find(
              (a) => a.kind === "place_nexus" && a.sourceInstanceId === "source"
            )!;
          expect(place).toBeDefined();
          const placed = f.close(f.apply(f.state, place));
          expect(
            placed.cardInstances.find((c) => c.instanceId === "source")!.zone
          ).toBe("field");
          expect(
            placed.cardInstances.find((c) => c.instanceId === "source")!
              .normalCoreCount
          ).toBe(0);
          expect(placed.players[0]!.reserveNormalCoreCount).toBe(
            10 - place.finalCost
          );
          if (siblingOwner === "alice") {
            expect(placed.pendingTriggeredEffects).toHaveLength(0);
            expect(placed.players[0]!.deckCount).toBe(size);
            continue;
          }
          expect(placed.pendingTriggeredEffects).toHaveLength(1);
          expect(placed.pendingTriggeredEffects[0]!.mechanic?.kind).toBe(
            "placement_oracle"
          );
          const { declared, after, action } = f.resolve(placed, !accept);
          expect(action.executionMode).toBe("optional");
          expect(declared.stackWindow !== null).toBe(accept);
          expect(declared.players[0]!.deckCount).toBe(size);
          expect(
            declared.cardInstances.find((c) => c.instanceId === "source")!
              .normalCoreCount
          ).toBe(0);
          const cores = accept ? (size < 3 ? 1 : 2) : 0;
          expect(
            after.cardInstances.find((c) => c.instanceId === "source")!
              .normalCoreCount
          ).toBe(cores);
          expect(after.players[0]!.voidNormalCoreCount).toBe(20 - cores);
          expect(after.players[0]!.deckCount).toBe(
            accept ? Math.max(0, size - 3) : size
          );
          expect(
            after.cardInstances.filter((c) => c.zone === "trash")
          ).toHaveLength(accept ? Math.min(3, size) : 0);
          expect(after.pendingTriggeredEffects).toHaveLength(0);
          expect(after.pendingStepOptionalChoice).toBeNull();
          if (!accept)
            expect(after.cardInstances).toEqual(placed.cardInstances);
        }
      }
    }
  });
});
