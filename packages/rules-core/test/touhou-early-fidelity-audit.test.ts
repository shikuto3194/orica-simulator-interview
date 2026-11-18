import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  applyLegalAction,
  createEmptyGameState,
  executeEffect,
  getEffectiveLevel,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { Effect, GameState, CardDefinition, ActiveStack } from "../src";
import { canSummonUltimate } from "../src/legal/legal-actions-shared";
import { evaluateCondition } from "../src/effect/structured-condition-eval";
import { runReevaluationAtTiming } from "../src/legal/legal-actions-shared";
import {
  deriveSuppressionEffectDescriptor,
  buildMagicLookup,
} from "../src/effect/structured-effect-registrations";
import { stackMatchesNegateAction } from "../src/stack/stack-negate";
import { matchesCardFilter } from "../src/card/card-filter";

const defs = new Map(ALL_CARDS.map((c) => [c.cardNo, c]));
const getDef = (id: string) => defs.get(id);
const card = (id: string) => getDef(id)!;
function field(
  id: string,
  instanceId: string,
  cores = 6,
  ownerPlayerId = "alice"
) {
  return createCardInstance(card(id), {
    instanceId,
    ownerPlayerId,
    controllerPlayerId: ownerPlayerId,
    zone: "field",
    normalCoreCount: cores,
  });
}
function resolve(state: GameState, effect: Effect, sourceInstanceId: string) {
  return executeEffect({
    chainId: "test:touhou-early-fidelity-audit:41",
    state,
    effect,
    sourceInstanceId,
    actingPlayerId: "alice",
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: () => [],
  });
}

describe("東方初期パック原文忠実度・盤面回帰", () => {
  it.each(["BSTH03-X01", "BSTH03-X04"])(
    "%s の耐性効果は抑制を受けず、防げない除去は耐性を貫通する",
    (id) => {
      for (const actor of ["alice", "bob"]) {
        let state = rebuildContinuousEffectsFromField(
          createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [
              field(id, "immortal", 4),
              field("BSTH02-C03", "suppressor", 1, actor),
            ],
          }),
          getDef
        );
        const suppress: Effect = {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "suppress_effect",
                target: {
                  kind: "filter",
                  player: "either",
                  filter: { category: ["ultimate"] },
                  count: 1,
                },
                effectFilter: { effectIndex: 0 },
                duration: { scope: "turn" },
              },
            },
          ],
        };
        state = executeEffect({
          chainId: "test:touhou-early-fidelity-audit:84",
          state,
          effect: suppress,
          sourceInstanceId: "suppressor",
          actingPlayerId: actor,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        });
        state = rebuildContinuousEffectsFromField(state, getDef);
        expect(
          state.activeContinuousEffects.some(
            (ce) =>
              ce.sourceInstanceId === "immortal" &&
              ce.modifierTag === "cannot_leave_field"
          )
        ).toBe(true);
        const destroy: Effect = {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "destroy",
                target: {
                  kind: "filter",
                  player: "either",
                  filter: { category: ["ultimate"] },
                  count: 1,
                },
              },
            },
          ],
        };
        const ordinary = executeEffect({
          chainId: "test:touhou-early-fidelity-audit:116",
          state,
          effect: destroy,
          sourceInstanceId: "suppressor",
          actingPlayerId: actor,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        });
        expect(
          ordinary.cardInstances.find((c) => c.instanceId === "immortal")
            ?.pendingLeaveKind
        ).toBeNull();
        const bypass = executeEffect({
          chainId: "test:touhou-early-fidelity-audit:128",
          state,
          effect: { ...destroy, preventionLevel: "unpreventable" },
          sourceInstanceId: "suppressor",
          actingPlayerId: actor,
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        });
        const target = bypass.cardInstances.find(
          (c) => c.instanceId === "immortal"
        )!;
        expect(
          target.zone !== "field" || target.pendingLeaveKind !== null
        ).toBe(true);
      }
    }
  );
  it.each([4, 5, 6])("最高Lvが%sの合体先を実効Lvで判定する", (maximum) => {
    const hostDef: CardDefinition = {
      ...card("BSTH05.5-X01"),
      cardNo: `MAX-${maximum}`,
      levelDefs: [
        { level: maximum - 1, requiredCores: 1, bp: 10000 },
        { level: maximum, requiredCores: 4, bp: 15000 },
      ],
    };
    const get = (id: string) => (id === hostDef.cardNo ? hostDef : getDef(id));
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostDef, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 4,
          attachedChildrenIds: ["sword"],
        }),
        { ...field("BSTH05.5-M01", "sword", 0), attachedToInstanceId: "host" },
      ],
    });
    state.activePlayerId = "alice";
    state.step = "attack";
    state.battleEntities = [
      {
        entityId: "battle",
        memberInstanceIds: ["host", "sword"],
        attackState: "attacking",
        resolvedBp: 19000,
        resolvedSymbols: ["blue"],
      },
    ];
    expect(
      evaluateCondition(
        state,
        card("BSTH05.5-M01").effects![1]!.condition!,
        "sword",
        "alice",
        get
      )
    ).toBe(true);
    state.cardInstances[0]!.normalCoreCount = 3;
    expect(
      evaluateCondition(
        state,
        card("BSTH05.5-M01").effects![1]!.condition!,
        "sword",
        "alice",
        get
      )
    ).toBe(false);
  });

  it.each([
    [5, 5, true],
    [8, 8, true],
    [4, 6, false],
    [6, 4, false],
    [9, 7, false],
    [7, 9, false],
  ])(
    "オルレアンの残留付与は印字%s・実効%sを両方検査する",
    (printed, effective, expected) => {
      const action = card("BSTH02.7-M01").effects![2]!.steps[0]!.action;
      if (action.kind !== "grant_effect" || action.target.kind !== "filter")
        throw new Error("missing grant");
      const definition = { ...card("BSTH02.7-M01"), cost: printed as number };
      expect(
        matchesCardFilter(
          field("BSTH02.7-M01", "orleans"),
          definition,
          action.target.filter,
          { effectiveCost: effective as number }
        )
      ).toBe(expected);
    }
  );

  it("ドールズウォーは通常メインでも使え、非黄単色ネクサスが混ざると使えない", () => {
    const lookup = buildMagicLookup(ALL_CARDS);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(card("BSTH02.7-C01"), {
          instanceId: "magic",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        field("BSTH02.7-CX01", "yellow-a", 3),
        field("BSTH02.7-CX01", "yellow-b", 3),
      ],
    });
    state.activePlayerId = "alice";
    state.step = "main";
    state.window = "none";
    const legal = (s: GameState) =>
      getLegalActions({
        state: s,
        actingPlayerId: "alice",
        getCardDefinitionById: getDef,
        getRegisteredMagicActions: lookup,
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      }).filter(
        (a) =>
          a.kind === "use_magic" &&
          a.sourceInstanceId === "magic" &&
          a.timing === "main"
      );
    expect(legal(state).length).toBeGreaterThan(0);
    expect(
      legal({
        ...state,
        cardInstances: [
          ...state.cardInstances,
          field("BSTH05-X02", "green-nexus", 3),
        ],
      })
    ).toHaveLength(0);
    const effect = card("BSTH02.7-C01").effects![2]!;
    const after = resolve(state, effect, "magic");
    expect(after.pendingStepChoice).toBeNull();
  });

  it.each(["BSTH05-X02", "BSTH05-C01"])(
    "穣子の召喚時保護を%s起源の抑制と無効化に対照する",
    (enemyId) => {
      const source = field("BSTH05-C02", "minoriko", 2);
      const enemy = field(enemyId, "enemy", 3, "bob");
      const state = rebuildContinuousEffectsFromField(
        createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [source, enemy],
        }),
        getDef
      );
      const suppression: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "suppress_effect",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
              duration: { scope: "turn" },
            },
          },
        ],
      };
      for (const event of ["summon", "attack"] as const) {
        if (suppression.steps[0]!.action.kind === "suppress_effect")
          suppression.steps[0]!.action.effectFilter = { eventAction: event };
        const suppressed = executeEffect({
          chainId: "test:touhou-early-fidelity-audit:303",
          state,
          effect: suppression,
          sourceInstanceId: "enemy",
          actingPlayerId: "bob",
          getCardDefinitionById: getDef,
          getRegisteredTriggeredEffectActions: () => [],
        });
        const descriptor = deriveSuppressionEffectDescriptor(
          { timing: { kind: "card_event", event }, steps: [] },
          { sourceDefinitionId: source.definitionId, effectIndex: 0 }
        );
        const expected = enemyId === "BSTH05-X02" && event === "summon";
        expect(
          runReevaluationAtTiming({
            state: suppressed,
            sourceInstanceId: source.instanceId,
            targetInstanceIds: [],
            timing: "before_each_step",
            suppressionEffectDescriptor: descriptor,
            registration: {
              reevaluationPoints: [
                {
                  timing: "before_each_step",
                  checks: ["effect_suppression"],
                  failurePolicy: "abort_remaining",
                },
              ],
            },
            getCardDefinitionById: getDef,
          }).passed
        ).toBe(expected);
        const stack = {
          cardInstanceId: source.instanceId,
          cardDefinitionId: source.definitionId,
          actingPlayerId: "alice",
          actionKind: "triggered_effect",
          suppressionEffectDescriptor: descriptor,
        } as ActiveStack;
        expect(
          stackMatchesNegateAction({
            state,
            stack,
            request: { negateTarget: "effect", sourceInstanceId: "enemy" },
            actingPlayerId: "bob",
            getCardDefinitionById: getDef,
          })
        ).toBe(!expected);
      }
      const exhaust: Effect = {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "exhaust",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
        ],
      };
      const after = executeEffect({
        chainId: "test:touhou-early-fidelity-audit:368",
        state,
        effect: exhaust,
        sourceInstanceId: "enemy",
        actingPlayerId: "bob",
        getCardDefinitionById: getDef,
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(
        after.cardInstances.find((c) => c.instanceId === "minoriko")
          ?.exhaustState
      ).toBe("exhausted");
    }
  );
  it("萃香のブロック不可は本人にだけ、このバトル中だけ付く", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        field("BSTH02-C03", "other"),
        field("BSTH02.5-X01", "suika"),
      ],
    });
    const after = resolve(state, card("BSTH02.5-X01").effects![3]!, "suika");
    const ces = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "unblockable"
    );
    expect(ces).toHaveLength(1);
    expect(ces[0]?.targetInstanceId).toBe("suika");
    expect(ces[0]?.duration.scope).toBe("battle");
  });

  it("妖夢の破壊耐性と追加シンボルは別の味方を対象にしない", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        field("BSTH02-C03", "other"),
        field("BSTH02-X03", "youmu"),
      ],
    });
    const state = rebuildContinuousEffectsFromField(
      { ...base, activePlayerId: "alice", step: "attack" },
      getDef
    );
    const own = state.activeContinuousEffects.filter(
      (ce) =>
        ce.sourceInstanceId === "youmu" &&
        ["cannot_destroy", "symbol_addition"].includes(ce.modifierTag)
    );
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((ce) => ce.targetInstanceId === "youmu")).toBe(true);
  });

  it.each(["BSTH03-C01", "BSTH03-M07", "BSTH03-M08", "BSTH03-R01"])(
    "%sはカウントが0のときだけ召喚できる",
    (id) => {
      const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
      const changed = {
        ...state,
        players: state.players.map((p) =>
          p.id === "alice" ? { ...p, countValue: 1 } : p
        ),
      };
      expect(
        canSummonUltimate(changed, "alice", card(id), getDef, {
          evaluateCondition,
        })
      ).toBe(false);
      expect(
        canSummonUltimate(state, "alice", card(id), getDef, {
          evaluateCondition,
        })
      ).toBe(true);
    }
  );

  it.each([
    "BSTH03-M01",
    "BSTH03-M02",
    "BSTH03-M05",
    "BSTH03-X01",
    "BSTH03-X04",
  ])("%sは必要色のシンボルなしでは召喚できない", (id) => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    expect(
      canSummonUltimate(state, "alice", card(id), getDef, { evaluateCondition })
    ).toBe(false);
    const withSymbols = {
      ...state,
      cardInstances: [
        field("BSTH05-C01", "green-symbol"),
        field("BSTH02.7-C02", "yellow-symbol"),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(withSymbols, getDef);
    expect(
      canSummonUltimate(rebuilt, "alice", card(id), getDef, {
        evaluateCondition,
      })
    ).toBe(true);
  });

  it("永夜抄アリスは相手スピリット/アルティメットが必要", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    expect(
      canSummonUltimate(state, "alice", card("BSTH03-M06"), getDef, {
        evaluateCondition,
      })
    ).toBe(false);
    expect(
      canSummonUltimate(
        { ...state, cardInstances: [field("BSTH02-C03", "enemy", 1, "bob")] },
        "alice",
        card("BSTH03-M06"),
        getDef,
        { evaluateCondition }
      )
    ).toBe(true);
  });

  it.each([
    ["BSTH05.5-C01", "alice"],
    ["BSTH05.5-M02", "bob"],
    ["BSTH05.5-M04", "bob"],
    ["BSTH05.5-X01", "bob"],
  ])("%sの召喚条件は指定側のライフ2以上", (id, player) => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const changed = {
      ...state,
      players: state.players.map((p) =>
        p.id === player
          ? { ...p, lifeNormalCoreCount: 1, lifeSoulCoreCount: 0 }
          : p
      ),
    };
    expect(
      canSummonUltimate(changed, "alice", card(id), getDef, {
        evaluateCondition,
      })
    ).toBe(false);
    expect(
      canSummonUltimate(state, "alice", card(id), getDef, { evaluateCondition })
    ).toBe(true);
  });

  it("契約域は同名別個体の契約ネクサスのLvコストを変えない", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        field("BSTH02.7-CX01", "source", 1),
        field("BSTH02.7-CX01", "other-contract", 1),
      ],
      playerOverrides: [{ countValue: 1 }, {}],
    });
    const after = rebuildContinuousEffectsFromField(
      { ...state, activePlayerId: "alice" },
      getDef
    );
    const other = after.cardInstances.find(
      (c) => c.instanceId === "other-contract"
    )!;
    expect(getEffectiveLevel(after, other, card("BSTH02.7-CX01"), getDef)).toBe(
      2
    );
  });

  it("契約技3の黄カード破棄でデッキ下からドローする", () => {
    const alice = card("BSTH02.7-CX01");
    const skill = alice.grandwalkerData!.divineSkills!.find(
      (s) => s.coreCost === 3
    )!;
    expect(skill.effects).toHaveLength(1);
    const deck = ["BSTH02.7-C02", "BSTH02-C03", "BSTH02.7-C03"].map((id, i) =>
      createCardInstance(card(id), {
        instanceId: `deck-${i}`,
        ownerPlayerId: "alice",
        zone: "deck",
      })
    );
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [field(alice.cardNo, "source"), ...deck],
      playerOverrides: [{ deckCount: 3, handCount: 0 }, {}],
    });
    let after = executeEffect({
      chainId: "test:touhou-early-fidelity-audit:551",
      state,
      effect: skill.effects![0]!,
      divineSkillIndex: 1,
      sourceInstanceId: "source",
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    });
    const accept = getLegalActions({
      state: after,
      actingPlayerId: "alice",
      getCardDefinitionById: getDef,
    }).find(
      (a) =>
        a.kind === "resolve_pending_step_optional_choice" &&
        a.choice === "execute"
    );
    expect(accept).toBeDefined();
    after = applyLegalAction({
      state: after,
      action: accept!,
      getCardDefinitionById: getDef,
    }).state;
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-0")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-1")?.zone
    ).toBe("trash");
    expect(
      after.cardInstances.find((c) => c.instanceId === "deck-2")?.zone
    ).toBe("hand");
  });
});
