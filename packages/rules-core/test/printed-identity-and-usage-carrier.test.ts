import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  evaluateCondition,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";

const definitions = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const spirit: CardDefinition = {
  cardNo: "TEST-USAGE-SPIRIT",
  name: "使用制限テストの対象",
  printedCategory: "spirit",
  cost: 0,
  colors: [],
  reductionSymbols: [],
  symbolColors: [],
  keywordTags: [],
  textLines: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
};
definitions.set(spirit.cardNo, spirit);
const lookup = (id: string) => definitions.get(id);
const magicLookup = buildMagicLookup(ALL_CARDS);
const legalOptions = {
  getCardDefinitionById: lookup,
  getRegisteredMagicActions: magicLookup,
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};

function instance(
  def: CardDefinition,
  id: string,
  zone: "field" | "hand" | "trash",
  owner = "alice"
) {
  return createCardInstance(def, {
    instanceId: id,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone,
    normalCoreCount: zone === "field" ? 1 : 0,
  });
}
function passStack(state: GameState) {
  for (
    let i = 0;
    (state.stackWindow ||
      state.activeAttack?.flashWindowState?.pendingStackAction) &&
    i < 10;
    i++
  ) {
    const priority =
      state.stackWindow?.priorityPlayerId ??
      state.activeAttack!.flashWindowState!.priorityPlayerId;
    const pass = getLegalActions({
      state,
      actingPlayerId: priority,
      ...legalOptions,
    }).find((a) => a.kind === "pass_stack" || a.kind === "pass_battle_flash");
    expect(pass).toBeDefined();
    state = applyLegalAction({ state, action: pass!, ...legalOptions }).state;
  }
  expect(state.stackWindow).toBeNull();
  return state;
}

describe("印字された自己の系統とカード使用制限", () => {
  it("BSTH03-X04 ultimate-added-tribe-all-zones: 起幻の手札破棄・トラッシュ回収と場の参照を確認", () => {
    const def = lookup("BSTH03-X04")!;
    expect(def.textLines).toContain(
      "このカード／アルティメットは、系統：「起幻」を持つ。"
    );
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance(spirit, "source", "field"),
        instance(def, "target-hand", "hand"),
        instance(def, "target-trash", "trash"),
        instance(def, "target-field", "field"),
        instance(spirit, "unrelated", "hand"),
      ],
      playerOverrides: [{ handCount: 2 }, {}],
    });
    expect(
      evaluateCondition(
        base,
        [{ kind: "field_has", player: "self", tribes: ["起幻"], minCount: 1 }],
        "source",
        "alice",
        lookup
      )
    ).toBe(true);
    const common = {
      chainId: "test:identity",
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
    };
    const recovered = executeEffect({
      ...common,
      state: base,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "search_zone",
              zone: "trash",
              filter: { tribes: ["起幻"] },
              count: 1,
              destination: "hand",
              mandatory: true,
            },
          },
        ],
      },
    });
    expect(recovered.pendingZoneSelection).toBeNull();
    expect(
      recovered.cardInstances.find((c) => c.instanceId === "target-trash")?.zone
    ).toBe("hand");
    expect(recovered.players[0]!.handCount).toBe(3);
    const discarded = executeEffect({
      ...common,
      state: recovered,
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "discard",
              count: "all",
              filter: { tribes: ["起幻"] },
            },
          },
        ],
      },
    });
    expect(discarded.pendingZoneSelection).toBeNull();
    expect(
      discarded.cardInstances
        .filter(
          (c) =>
            c.instanceId === "target-hand" || c.instanceId === "target-trash"
        )
        .map((c) => c.zone)
    ).toEqual(["trash", "trash"]);
    expect(
      discarded.cardInstances.find((c) => c.instanceId === "unrelated")?.zone
    ).toBe("hand");
    expect(
      discarded.cardInstances.find((c) => c.instanceId === "target-field")?.zone
    ).toBe("field");
    expect(discarded.players[0]!.handCount).toBe(1);
  });

  it("BSTH03-R03/BSTH06-R01 card-attack-step-use-restriction: 両ターンのフラッシュ/スタック完走と他ステップ不発", () => {
    for (const no of ["BSTH03-R03", "BSTH06-R01"]) {
      const def = lookup(no)!;
      expect(def.textLines).toContain(
        "このカードは、『お互いのアタックステップ』にしか使えない。"
      );
      for (const activePlayerId of ["alice", "bob"]) {
        const base = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [
            instance(def, "magic", "hand"),
            instance(spirit, "enemy1", "field", "bob"),
            instance(spirit, "enemy2", "field", "bob"),
            instance(spirit, "ally1", "field"),
            instance(spirit, "ally2", "field"),
            {
              ...instance(spirit, "attacker", "field", activePlayerId),
              exhaustState: "exhausted",
            },
          ],
          battleEntities: [
            {
              entityId: "attacker-entity",
              memberInstanceIds: ["attacker"],
              resolvedBp: 1000,
              resolvedSymbols: [],
              attackState: "attacking",
            },
          ],
          playerOverrides: [{ reserveNormalCoreCount: 10, handCount: 1 }, {}],
        });
        const attack: GameState = {
          ...base,
          activePlayerId,
          step: "attack",
          window: "flash_before_block",
          activeAttack: {
            attackId: "attack:usage",
            primaryEntityId: "attacker-entity",
            participantEntityIds: ["attacker-entity"],
            groupMode: "single",
            target: {
              kind: "player",
              playerId: activePlayerId === "alice" ? "bob" : "alice",
            },
            blockAssignments: [],
            symbolResolutionOrder: [],
            flashBeforeBlockCompleted: false,
            flashAfterBlockCompleted: false,
            flashWindowState: {
              kind: "before_block",
              priorityPlayerId: "alice",
              consecutivePassCount: 0,
              stackResponseSourcePlayerId: "alice",
              pendingStackAction: null,
            },
          },
        };
        // Obtain the response window through a real magic declaration, so the
        // stack half is tested separately from the active flash half.
        for (const timing of ["flash", "stack"] as const) {
          let state = attack;
          if (timing === "stack") {
            const replyBase = {
              ...attack,
              cardInstances: [
                ...attack.cardInstances,
                instance(def, "opponent-magic", "hand", "bob"),
              ],
              players: attack.players.map((p) =>
                p.id === "bob"
                  ? { ...p, reserveNormalCoreCount: 10, handCount: 1 }
                  : p
              ),
              activeAttack: {
                ...attack.activeAttack!,
                flashWindowState: {
                  ...attack.activeAttack!.flashWindowState!,
                  priorityPlayerId: "bob",
                  stackResponseSourcePlayerId: "bob",
                },
              },
            };
            const opening = getLegalActions({
              state: replyBase,
              actingPlayerId: "bob",
              ...legalOptions,
            }).find(
              (a) =>
                a.kind === "use_magic" &&
                a.sourceInstanceId === "opponent-magic" &&
                a.timing === "flash"
            );
            expect(opening).toBeDefined();
            if (opening?.kind !== "use_magic")
              throw new Error("opening magic missing");
            state = applyLegalAction({
              state: replyBase,
              action: opening,
              ...legalOptions,
              targetInstanceIds: ["ally1", "ally2"],
              paymentSources: [{ kind: "reserve", amount: opening.finalCost }],
            }).state;
            expect(
              state.stackWindow?.priorityPlayerId ??
                state.activeAttack?.flashWindowState?.priorityPlayerId
            ).toBe("alice");
          }
          for (const step of [
            "main",
            "start",
            "core",
            "draw",
            "refresh",
            "end",
          ] as const) {
            expect(
              getLegalActions({
                state: { ...state, step },
                actingPlayerId: "alice",
                ...legalOptions,
              }).filter(
                (a) => a.kind === "use_magic" && a.sourceInstanceId === "magic"
              )
            ).toHaveLength(0);
          }
          const action = getLegalActions({
            state,
            actingPlayerId: "alice",
            ...legalOptions,
          }).find(
            (a) =>
              a.kind === "use_magic" &&
              a.sourceInstanceId === "magic" &&
              a.timing === timing
          );
          expect(action).toBeDefined();
          if (action?.kind !== "use_magic") throw new Error("magic missing");
          const declared = applyLegalAction({
            state,
            action,
            ...legalOptions,
            ...(action.targetMode === "none"
              ? {}
              : { targetInstanceIds: ["enemy1", "enemy2"] }),
            paymentSources: [{ kind: "reserve", amount: action.finalCost }],
          }).state;
          let after = passStack(declared);
          if (no === "BSTH06-R01" && timing === "stack") {
            const choice = getLegalActions({
              state: after,
              actingPlayerId: "alice",
              ...legalOptions,
            }).find(
              (a) =>
                a.kind === "resolve_pending_step_choice" && a.choiceIndex === 0
            );
            expect(choice).toBeDefined();
            after = applyLegalAction({
              state: after,
              action: choice!,
              ...legalOptions,
            }).state;
            const target = getLegalActions({
              state: after,
              actingPlayerId: "alice",
              ...legalOptions,
            }).find((a) => a.kind === "resolve_pending_effect_target");
            expect(target).toBeDefined();
            after = applyLegalAction({
              state: after,
              action: target!,
              ...legalOptions,
              targetInstanceIds: ["enemy1", "enemy2"],
            }).state;
            after = passStack(after);
          }
          expect(
            after.cardInstances.find((c) => c.instanceId === "magic")?.zone
          ).toBe("trash");
          expect(after.pendingStepChoice).toBeNull();
          expect(after.pendingEffectTargetSelection).toBeNull();
          expect(
            after.activeAttack?.flashWindowState?.pendingStackAction
          ).toBeNull();
          if (timing === "stack") {
            expect(
              after.cardInstances.find((c) => c.instanceId === "opponent-magic")
                ?.zone
            ).toBe("trash");
          }
          expect(after.players[0]!.reserveNormalCoreCount).toBe(
            10 - action.finalCost
          );
          expect(
            after.cardInstances
              .filter((c) => c.instanceId.startsWith("enemy"))
              .map((c) => c.exhaustState)
          ).toEqual([
            timing === "flash" ? "heavily_exhausted" : "exhausted",
            timing === "flash" ? "heavily_exhausted" : "exhausted",
          ]);
        }
      }
    }
  });
});
