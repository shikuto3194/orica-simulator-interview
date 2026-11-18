import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type ContinuousEffect,
  type GameState,
  type OracleTriggerKind,
} from "../src/runtime";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import {
  getEffectiveCost,
  getEffectiveTribes,
} from "../src/legal/legal-actions-shared";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
} from "../src/mechanics/oracle-system";

type Target = {
  category: CardDefinition["printedCategory"];
  tribes: string[];
  cost?: number;
  rebirth?: boolean;
  accel?: boolean;
};
const spirit = (tribes: string[], cost = 3): Target => ({
  category: "spirit",
  tribes,
  cost,
});
const nexus = (tribes: string[], cost = 3, rebirth = false): Target => ({
  category: "nexus",
  tribes,
  cost,
  rebirth,
});
// Expectations are transcribed from the printed headers, independent of oracleConditions.
const profiles: {
  no: string;
  events: OracleTriggerKind[];
  yes: Target[];
  noTargets: Target[];
}[] = [
  {
    no: "BSTH01-XX01",
    events: ["summon", "advent", "place"],
    yes: [
      spirit(["幻想"]),
      { category: "ultimate", tribes: ["幻想"] },
      { category: "brave", tribes: ["幻想"] },
      nexus(["賢者"]),
    ],
    noTargets: [
      nexus(["幻想"]),
      spirit(["賢者"]),
      { category: "magic", tribes: ["幻想"] },
    ],
  },
  {
    no: "BSTH02-X01",
    events: ["summon", "advent"],
    yes: [spirit(["幻想", "冥主"], 5)],
    noTargets: [
      spirit(["幻想", "冥主"], 4),
      spirit(["幻想"], 5),
      spirit(["冥主"], 5),
      nexus(["幻想", "冥主"], 5),
    ],
  },
  ...["BSTH04-X01", "BSTH04-XX01"].map((no) => ({
    no,
    events: ["summon", "advent", "place"] as OracleTriggerKind[],
    yes: [spirit(["幻想"]), nexus(["幻想"]), nexus([], 0, true)],
    noTargets: [
      spirit(["幻想"], 2),
      nexus(["幻想"], 2),
      { ...spirit([], 0), rebirth: true },
      { category: "magic" as const, tribes: ["幻想"], cost: 3 },
    ],
  })),
  {
    no: "BSTH02.7-CX01",
    events: ["summon", "place"],
    yes: [
      spirit(["動玩"]),
      spirit(["四道"]),
      spirit(["導魔"]),
      nexus(["導魔"]),
      nexus([], 0, true),
    ],
    noTargets: [
      spirit(["幻想"]),
      spirit(["導魔"], 2),
      { ...spirit([], 0), rebirth: true },
      { category: "magic", tribes: ["導魔"], cost: 3 },
    ],
  },
  {
    no: "BSTH07-X01",
    events: ["summon", "advent", "place"],
    yes: [
      spirit(["星蓮"]),
      spirit(["闘神"]),
      nexus(["星蓮"]),
      nexus(["闘神"]),
      nexus([], 0, true),
    ],
    noTargets: [
      spirit(["星蓮"], 2),
      nexus(["闘神"], 2),
      spirit(["幻想"]),
      { category: "ultimate", tribes: ["星蓮"] },
      { category: "magic", tribes: ["闘神"] },
    ],
  },
  {
    no: "BSTH07.8-XX01",
    events: ["summon", "advent"],
    yes: [
      spirit(["妖精"], 0),
      { category: "ultimate", tribes: ["妖精"], cost: 0 },
    ],
    noTargets: [
      nexus(["妖精"]),
      { category: "brave", tribes: ["妖精"] },
      spirit(["幻想"]),
    ],
  },
  {
    no: "BSTH08-X01",
    events: ["summon", "advent", "place"],
    yes: [spirit(["幻想"]), nexus(["幻想"]), nexus([], 0, true)],
    noTargets: [
      spirit(["幻想"], 2),
      nexus(["幻想"], 2),
      { category: "ultimate", tribes: ["幻想"] },
      { ...spirit([], 0), rebirth: true },
    ],
  },
  {
    no: "BSTH08.5-X03",
    events: ["summon", "advent", "use_accel"],
    yes: [
      spirit(["面霊"]),
      spirit(["天渡"]),
      spirit(["化神"]),
      { category: "brave", tribes: [], cost: 0, accel: true },
    ],
    noTargets: [
      spirit(["面霊"], 2),
      nexus(["面霊"]),
      { category: "brave", tribes: ["面霊"] },
      { category: "magic", tribes: ["面霊"], accel: true },
      { ...spirit([], 0), accel: true },
    ],
  },
  ...["BSTH09.2-X01", "BSTH09.2-XX01"].map((no) => ({
    no,
    events: ["summon", "advent", "place"] as OracleTriggerKind[],
    yes: [
      spirit(["幻想"]),
      nexus(["幻想"]),
      { category: "ultimate" as const, tribes: ["幻想"] },
      nexus([], 0, true),
    ],
    noTargets: [
      spirit(["幻想"], 2),
      nexus(["幻想"], 2),
      { category: "ultimate" as const, tribes: ["幻想"], cost: 2 },
      { category: "brave" as const, tribes: ["幻想"] },
      { category: "magic" as const, tribes: ["幻想"] },
    ],
  })),
];

function fixture(
  no: string,
  target: Target,
  options: { owner?: string; zone?: "field" | "deck"; sibling?: boolean } = {}
) {
  const definition = ALL_CARDS.find((c) => c.cardNo === no)!;
  const trigger: CardDefinition = {
    cardNo: "TEST-PRINTED-ORACLE-TARGET",
    name: "本文条件を検証する対象",
    printedCategory: target.category,
    colors: ["red"],
    cost: target.cost ?? 3,
    reductionSymbols: [],
    symbolColors: [],
    levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
    tribe: target.tribes.join("・"),
    keywordTags: [],
    textLines: [],
    ...(target.rebirth ? { isDoubleSided: true } : {}),
    ...(target.accel
      ? { accelData: { cost: 1, reduction: [], effects: [] } }
      : {}),
  };
  const lookup = (id: string) =>
    id === trigger.cardNo ? trigger : ALL_CARDS.find((c) => c.cardNo === id);
  const make = (
    id: string,
    def: CardDefinition,
    zone: "field" | "deck",
    owner = "alice"
  ) =>
    createCardInstance(def, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      make("source", definition, "field"),
      make("target", trigger, options.zone ?? "field", options.owner),
      ...(options.sibling ? [make("sibling", definition, "field")] : []),
    ],
    playerOverrides: [{ voidNormalCoreCount: 20 }, { voidNormalCoreCount: 20 }],
  });
  return { state, lookup, make, definition, trigger };
}

function resolvePending(
  state: GameState,
  lookup: (id: string) => CardDefinition | undefined,
  accept = true
): GameState {
  const pending = state.pendingTriggeredEffects.find(
    (p) =>
      p.mechanic?.kind === "oracle" || p.mechanic?.kind === "placement_oracle"
  )!;
  expect(pending).toBeDefined();
  const sourceId =
    pending.mechanic && "grandwalkerInstanceId" in pending.mechanic
      ? pending.mechanic.grandwalkerInstanceId
      : "source";
  const coresBefore = state.cardInstances.find(
    (c) => c.instanceId === sourceId
  )!.normalCoreCount;
  const action = getLegalActions({
    state,
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: lookup,
  }).find(
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.pendingId === pending.pendingId
  );
  expect(action).toBeDefined();
  let result = applyLegalAction({
    state,
    action: action!,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: () => [],
    ...(!accept ? { skipOptionalEffect: true } : {}),
  }).state;
  if (accept) {
    expect(result.stackWindow).not.toBeNull();
    expect(
      result.cardInstances.find((c) => c.instanceId === sourceId)
        ?.normalCoreCount
    ).toBe(coresBefore);
    for (let count = 0; result.stackWindow && count < 10; count++) {
      const pass = getLegalActions({
        state: result,
        actingPlayerId: result.stackWindow.priorityPlayerId,
        getCardDefinitionById: lookup,
        getRegisteredFieldCardEffectActions: () => [],
      }).find((a) => a.kind === "pass_stack");
      expect(pass).toBeDefined();
      result = applyLegalAction({
        state: result,
        action: pass!,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      }).state;
    }
  }
  expect(result.stackWindow).toBeNull();
  expect(
    result.pendingTriggeredEffects.some(
      (p) => p.pendingId === pending.pendingId
    )
  ).toBe(false);
  return result;
}

function tribeOverride(
  properties: { tribes?: string[]; addTribes?: string[]; cost?: number },
  global = false
): ContinuousEffect {
  return {
    effectId: "printed-oracle-tribe-override",
    sourceInstanceId: "target",
    sourceDefinitionId: "TEST-PRINTED-ORACLE-TARGET",
    actingPlayerId: "alice",
    modifierTag: "override_properties",
    duration: { scope: "turn" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    ...(global
      ? { targetFilter: { player: "self" as const, zone: ["field" as const] } }
      : { targetInstanceId: "target" }),
    metadata: { properties },
  };
}

describe("印字された導託の条件と実行", () => {
  for (const no of ["BSTH08.5-X03", "BSTH09.2-X01"]) {
    it(`${no}: 通常神託は実効コストと追加コストを参照し、窓後まで解決する`, () => {
      const tribe = no === "BSTH08.5-X03" ? "面霊" : "幻想";
      for (const event of ["summon", "advent"] as const) {
        for (const scenario of [
          { printed: 3, effective: 2, additional: undefined, matches: false },
          { printed: 2, effective: 3, additional: undefined, matches: true },
          { printed: 3, effective: 2, additional: 3, matches: true },
          { printed: 3, effective: 1, additional: 2, matches: false },
        ]) {
          for (const accept of [false, true]) {
            const f = fixture(no, spirit([tribe], scenario.printed));
            const override = tribeOverride({ cost: scenario.effective });
            const state: GameState = {
              ...f.state,
              activeContinuousEffects: [
                override,
                ...(scenario.additional === undefined
                  ? []
                  : [
                      {
                        ...override,
                        effectId: "oracle-additional-cost",
                        modifierTag: "additional_cost" as const,
                        modifierAmount: scenario.additional,
                        targetFilter: undefined,
                        targetInstanceId: "target",
                        metadata: {},
                      },
                    ]),
              ],
            };
            expect(
              getEffectiveCost(
                state,
                state.cardInstances.find((c) => c.instanceId === "target")!,
                f.trigger,
                f.lookup
              )
            ).toBe(scenario.effective);
            const queued = checkAndQueueOracleChoices(
              state,
              "target",
              event,
              f.lookup,
              "test:oracle:effective-cost"
            );
            expect(queued.pendingTriggeredEffects).toHaveLength(
              scenario.matches ? 1 : 0
            );
            const after = scenario.matches
              ? resolvePending(queued, f.lookup, accept)
              : queued;
            expect(
              after.cardInstances.find((c) => c.instanceId === "source")!
                .normalCoreCount
            ).toBe(scenario.matches && accept ? 1 : 0);
            expect(after.players[0]!.voidNormalCoreCount).toBe(
              scenario.matches && accept ? 19 : 20
            );
            expect(after.pendingTriggeredEffects).toHaveLength(0);
            expect(after.stackWindow).toBeNull();
          }
        }
      }
    });
    it(`${no}: 煌臨後の合体コストを数え、分離済みブレイヴは数えない`, () => {
      for (const attached of [false, true]) {
        const f = fixture(
          no,
          spirit([no === "BSTH08.5-X03" ? "面霊" : "幻想"], 1)
        );
        const braveDef: CardDefinition = {
          ...f.trigger,
          cardNo: "TEST-ORACLE-COST-BRAVE",
          printedCategory: "brave",
          cost: 2,
        };
        const brave = f.make("cost-brave", braveDef, "field");
        brave.zoneRoleName = "brave";
        brave.attachedToInstanceId = attached ? "target" : null;
        const state: GameState = {
          ...f.state,
          cardInstances: [
            ...f.state.cardInstances.map((card) =>
              card.instanceId === "target" && attached
                ? { ...card, attachedChildrenIds: [brave.instanceId] }
                : card
            ),
            brave,
          ],
        };
        const lookup = (id: string) =>
          id === braveDef.cardNo ? braveDef : f.lookup(id);
        const queued = checkAndQueueOracleChoices(
          state,
          "target",
          "advent",
          lookup,
          "test:oracle:combined-cost"
        );
        expect(queued.pendingTriggeredEffects).toHaveLength(attached ? 1 : 0);
        const after = attached ? resolvePending(queued, lookup) : queued;
        expect(
          after.cardInstances.find((c) => c.instanceId === "source")!
            .normalCoreCount
        ).toBe(attached ? 1 : 0);
        expect(after.players[0]!.voidNormalCoreCount).toBe(attached ? 19 : 20);
        expect(after.pendingTriggeredEffects).toHaveLength(0);
        expect(after.stackWindow).toBeNull();
      }
    });
  }
  for (const profile of profiles) {
    it(`${profile.no} printed_oracle: 実効系統の追加と置換をOR/AND条件へ反映し最終コアを確認`, () => {
      for (const target of profile.yes.filter((t) => t.tribes.length > 0)) {
        const baseTribes = profile.no === "BSTH02-X01" ? ["幻想"] : ["非対象"];
        const gainedTribes =
          profile.no === "BSTH02-X01" ? ["冥主"] : target.tribes;
        for (const global of [false, true]) {
          for (const accept of [true, false]) {
            const f = fixture(profile.no, { ...target, tribes: baseTribes });
            const state = {
              ...f.state,
              activeContinuousEffects: [
                tribeOverride({ addTribes: gainedTribes }, global),
              ],
            };
            const instance = state.cardInstances.find(
              (c) => c.instanceId === "target"
            )!;
            expect(
              getEffectiveTribes(state, instance, f.trigger, f.lookup)
            ).toEqual([...baseTribes, ...gainedTribes]);
            for (const event of profile.events) {
              const queued = checkAndQueueOracleChoices(
                state,
                "target",
                event,
                f.lookup,
                `test:printed-oracle:effective:${event}`
              );
              expect(
                queued.pendingTriggeredEffects.filter(
                  (p) => p.mechanic?.kind === "oracle"
                )
              ).toHaveLength(1);
              const after = resolvePending(queued, f.lookup, accept);
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
        const f = fixture(profile.no, target);
        const state = {
          ...f.state,
          activeContinuousEffects: [tribeOverride({ tribes: ["非対象"] })],
        };
        const instance = state.cardInstances.find(
          (c) => c.instanceId === "target"
        )!;
        expect(
          getEffectiveTribes(state, instance, f.trigger, f.lookup)
        ).toEqual(["非対象"]);
        for (const event of profile.events) {
          const after = checkAndQueueOracleChoices(
            state,
            "target",
            event,
            f.lookup,
            `test:printed-oracle:replaced:${event}`
          );
          expect(after.pendingTriggeredEffects).toHaveLength(0);
          expect(after.stackWindow).toBeNull();
          expect(
            after.cardInstances.find((c) => c.instanceId === "source")
              ?.normalCoreCount
          ).toBe(0);
          expect(after.players[0]!.voidNormalCoreCount).toBe(20);
        }

        // 配置時の「その中の対象カード」も、トラッシュ移動後の実効系統で数える。
        for (const gained of [true, false]) {
          const placement = fixture(
            profile.no,
            { ...target, tribes: gained ? baseTribes : target.tribes },
            { zone: "deck" }
          );
          const placementState = {
            ...placement.state,
            players: placement.state.players.map((p) =>
              p.id === "alice" ? { ...p, deckCount: 1 } : p
            ),
            activeContinuousEffects: [
              tribeOverride(
                gained ? { addTribes: gainedTribes } : { tribes: ["非対象"] }
              ),
            ],
          };
          const queued = checkAndQueuePlacementOracle(
            placementState,
            "source",
            placement.lookup,
            "test:printed-placement:effective"
          );
          const after = resolvePending(queued, placement.lookup);
          expect(
            after.cardInstances.find((c) => c.instanceId === "target")?.zone
          ).toBe("trash");
          expect(after.players[0]!.deckCount).toBe(0);
          expect(
            after.cardInstances.find((c) => c.instanceId === "source")
              ?.normalCoreCount
          ).toBe(gained ? 1 : 0);
          expect(after.players[0]!.voidNormalCoreCount).toBe(gained ? 19 : 20);
        }
      }
    });

    it(`${profile.no} printed_oracle: 全印字条件の受諾/辞退と非対象・非印字イベントを最終盤面で確認`, () => {
      for (const target of profile.yes) {
        for (const event of profile.events) {
          for (const accept of [true, false]) {
            const f = fixture(profile.no, target);
            const queued = checkAndQueueOracleChoices(
              f.state,
              "target",
              event,
              f.lookup,
              `test:printed-oracle:${profile.no}:${event}`
            );
            expect(
              queued.pendingTriggeredEffects.filter(
                (p) => p.mechanic?.kind === "oracle"
              )
            ).toHaveLength(1);
            const after = resolvePending(queued, f.lookup, accept);
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
      for (const target of profile.noTargets) {
        const f = fixture(profile.no, target);
        const after = checkAndQueueOracleChoices(
          f.state,
          "target",
          "summon",
          f.lookup,
          "test:printed-oracle:nonmatch"
        );
        expect(after.pendingTriggeredEffects).toHaveLength(0);
        expect(after.players[0]!.voidNormalCoreCount).toBe(20);
      }
      const f = fixture(profile.no, profile.yes[0]!);
      for (const event of [
        "summon",
        "advent",
        "place",
        "use_magic",
        "use_accel",
      ] as OracleTriggerKind[]) {
        if (!profile.events.includes(event))
          expect(
            checkAndQueueOracleChoices(
              f.state,
              "target",
              event,
              f.lookup,
              "test:printed-oracle:event"
            ).pendingTriggeredEffects
          ).toHaveLength(0);
      }
      const enemy = fixture(profile.no, profile.yes[0]!, { owner: "bob" });
      expect(
        checkAndQueueOracleChoices(
          enemy.state,
          "target",
          "summon",
          enemy.lookup,
          "test:printed-oracle:opponent"
        ).pendingTriggeredEffects
      ).toHaveLength(0);
    });

    it(`${profile.no} printed_placement_oracle: 上3枚を直接トラッシュへ置き対象2枚のコアを得て同名制限を守る`, () => {
      const f = fixture(profile.no, profile.yes[0]!, { zone: "deck" });
      const miss: CardDefinition = {
        ...f.trigger,
        cardNo: "TEST-NONMATCH",
        printedCategory: "magic",
        tribe: "非対象",
      };
      const lookup = (id: string) => (id === miss.cardNo ? miss : f.lookup(id));
      const state = {
        ...f.state,
        players: f.state.players.map((p) =>
          p.id === "alice" ? { ...p, deckCount: 4 } : p
        ),
        cardInstances: [
          ...f.state.cardInstances,
          f.make("hit2", f.trigger, "deck"),
          f.make("miss", miss, "deck"),
          f.make("fourth", f.trigger, "deck"),
        ],
      };
      for (const accept of [true, false]) {
        const queued = checkAndQueuePlacementOracle(
          state,
          "source",
          lookup,
          "test:printed-placement"
        );
        const after = resolvePending(queued, lookup, accept);
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
        expect(after.players[0]!.voidNormalCoreCount).toBe(accept ? 18 : 20);
        expect(after.players[0]!.deckCount).toBe(accept ? 1 : 4);
        if (profile.no === "BSTH02.7-CX01" && accept) {
          const siblingState = {
            ...after,
            cardInstances: [
              ...after.cardInstances,
              f.make("sibling", f.definition, "field"),
            ],
          };
          expect(
            checkAndQueuePlacementOracle(
              siblingState,
              "sibling",
              lookup,
              "test:printed-placement:second"
            ).pendingTriggeredEffects.filter(
              (p) => p.mechanic?.kind === "placement_oracle"
            )
          ).toHaveLength(0);
        }
      }
      const withSibling = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          f.make("sibling", f.definition, "field"),
        ],
      };
      const siblingQueue = checkAndQueuePlacementOracle(
        withSibling,
        "source",
        lookup,
        "test:printed-placement:sibling"
      );
      expect(siblingQueue.pendingTriggeredEffects).toHaveLength(
        ["BSTH02.7-CX01", "BSTH07.8-XX01"].includes(profile.no) ? 1 : 0
      );
      if (profile.no === "BSTH07.8-XX01") {
        const first = resolvePending(siblingQueue, lookup);
        expect(
          first.cardInstances.find((c) => c.instanceId === "source")
            ?.normalCoreCount
        ).toBe(2);
        expect(
          first.cardInstances.find((c) => c.instanceId === "sibling")
            ?.normalCoreCount
        ).toBe(0);
        expect(first.players[0]!.deckCount).toBe(1);
        // 同名共有のターン制限も印字されていない。同ターンに別個体も発揮し完走する。
        const second = resolvePending(
          checkAndQueuePlacementOracle(
            first,
            "sibling",
            lookup,
            "test:printed-placement:sibling-second"
          ),
          lookup
        );
        expect(
          second.cardInstances.find((c) => c.instanceId === "source")
            ?.normalCoreCount
        ).toBe(2);
        expect(
          second.cardInstances.find((c) => c.instanceId === "sibling")
            ?.normalCoreCount
        ).toBe(1);
        expect(
          second.cardInstances.find((c) => c.instanceId === "fourth")?.zone
        ).toBe("trash");
        expect(second.players[0]!.deckCount).toBe(0);
        expect(second.players[0]!.voidNormalCoreCount).toBe(17);
      }
      const withEnemy = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          f.make("enemy", f.definition, "field", "bob"),
        ],
      };
      expect(
        checkAndQueuePlacementOracle(
          withEnemy,
          "source",
          lookup,
          "test:printed-placement:enemy"
        ).pendingTriggeredEffects
      ).toHaveLength(1);
    });
  }
});
