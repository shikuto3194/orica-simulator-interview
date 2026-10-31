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

// 期待値は保存原文のヘッダと列挙イベントから独立に転記する。
function target(
  category: CardDefinition["printedCategory"],
  tribe: string,
  cost = 3,
  rebirth = false
): CardDefinition {
  return {
    cardNo: `TEST-KANAKO-MIKO-${category}-${tribe}-${cost}-${rebirth}`,
    name: "神託の印字条件を検証する対象",
    printedCategory: category,
    colors: ["red"],
    cost,
    tribe,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    keywordTags: [],
    textLines: [],
    ...(rebirth ? { isDoubleSided: true } : {}),
    accelData: { cost: 1, reduction: [], effects: [] },
  };
}
const profiles = [
  {
    no: "BSTH05-X01",
    hits: [
      ...["風神", "化神", "神渡"].flatMap((tribe) => [
        target("spirit", tribe),
        target("nexus", tribe),
      ]),
      target("nexus", "アシハラ", 0),
    ],
    misses: [
      ...["風神", "化神", "神渡"].flatMap((tribe) => [
        target("spirit", tribe, 2),
        target("nexus", tribe, 2),
        target("magic", tribe),
        target("brave", tribe),
      ]),
      target("spirit", "アシハラ"),
      target("nexus", "幻想"),
    ],
  },
  {
    no: "BSTH08-XX01",
    hits: [
      target("spirit", "幻想"),
      target("nexus", "幻想"),
      target("nexus", "非対象", 0, true),
    ],
    misses: [
      target("spirit", "幻想", 2),
      target("nexus", "幻想", 2),
      target("ultimate", "幻想"),
      target("magic", "幻想"),
      target("brave", "幻想"),
      target("spirit", "非対象", 0, true),
      target("nexus", "非対象"),
    ],
  },
];
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

describe("BSTH05-X01 / BSTH08-XX01 の印字神託", () => {
  for (const profile of profiles) {
    const definition = ALL_CARDS.find((c) => c.cardNo === profile.no)!;
    it(`${profile.no}: 各OR条件と列挙イベントだけを受諾/辞退し窓後のコアを確認`, () => {
      expect(definition.grandwalkerData!.oracleTriggerKinds).toEqual([
        "summon",
        "advent",
        "place",
      ]);
      for (const def of [...profile.hits, ...profile.misses]) {
        for (const event of [
          "summon",
          "advent",
          "place",
          "use_magic",
          "use_accel",
        ] as OracleTriggerKind[]) {
          for (const owner of ["alice", "bob"]) {
            for (const accept of [true, false]) {
              const f = fixture(definition, [def], false, undefined, owner);
              const queued = checkAndQueueOracleChoices(
                f.state,
                "target-0",
                event,
                f.lookup,
                "test:kanako-miko:oracle"
              );
              const expected =
                profile.hits.includes(def) &&
                ["summon", "advent", "place"].includes(event) &&
                owner === "alice";
              expect(queued.pendingTriggeredEffects).toHaveLength(
                expected ? 1 : 0
              );
              if (!expected) {
                expect(queued.stackWindow).toBeNull();
                expect(
                  queued.cardInstances.find((c) => c.instanceId === "source")!
                    .normalCoreCount
                ).toBe(0);
                expect(queued.players[0]!.voidNormalCoreCount).toBe(20);
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
    it(`${profile.no}: イベント列挙のない旧ランタイム入力はアクセル神託を発火しない`, () => {
      const { oracleTriggerKinds: _events, ...legacyData } =
        definition.grandwalkerData!;
      const broken: CardDefinition = {
        ...definition,
        grandwalkerData: legacyData as CardDefinition["grandwalkerData"],
      };
      const f = fixture(broken, [profile.hits[0]!]);
      expect(
        checkAndQueueOracleChoices(
          f.state,
          "target-0",
          "use_accel",
          f.lookup,
          "test:kanako-miko:broken"
        ).pendingTriggeredEffects
      ).toHaveLength(0);
    });
    it(`${profile.no}: 通常配置から任意神託を完走し上3枚/対象数/同名不在を最終盤面で確認`, () => {
      for (const size of [1, 2, 4]) {
        for (const siblingOwner of [undefined, "alice", "bob"]) {
          for (const accept of [true, false]) {
            const deck = [
              profile.hits[0]!,
              profile.misses.at(-1)!,
              profile.hits.at(-1)!,
              profile.hits[0]!,
            ].slice(0, size);
            const f = fixture(definition, deck, true, siblingOwner);
            const place = f
              .actions(f.state)
              .find(
                (a) =>
                  a.kind === "place_nexus" && a.sourceInstanceId === "source"
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
            const placement = placed.pendingTriggeredEffects.find(
              (p) => p.mechanic?.kind === "placement_oracle"
            );
            if (siblingOwner === "alice") {
              expect(placement).toBeUndefined();
              expect(placed.players[0]!.deckCount).toBe(size);
              expect(
                placed.cardInstances.filter((c) => c.zone === "trash")
              ).toHaveLength(0);
              continue;
            }
            expect(placement).toBeDefined();
            const { declared, after, action } = f.resolve(placed, !accept);
            expect(action.executionMode).toBe("optional");
            expect(declared.stackWindow !== null).toBe(accept);
            expect(declared.players[0]!.deckCount).toBe(size);
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
              after.cardInstances
                .filter((c) => c.zone === "trash")
                .map((c) => c.instanceId)
            ).toEqual(
              accept ? ["target-0", "target-1", "target-2"].slice(0, size) : []
            );
            if (size === 4)
              expect(
                after.cardInstances.find((c) => c.instanceId === "target-3")!
                  .zone
              ).toBe("deck");
            expect(after.pendingTriggeredEffects).toHaveLength(0);
            expect(after.pendingStepOptionalChoice).toBeNull();
          }
        }
      }
    });
  }
});
