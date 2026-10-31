import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  rebuildContinuousEffectsFromField,
  recomputeAndRebuildContinuousEffects,
} from "../src/effect/continuous-effect-rebuild";
import { getAvailableDivineSkillLegalActions } from "../src/legal/legal-actions-availability";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { resolveDeferredDivineSkillStack } from "../src/legal/mechanic-trigger-handlers";
import { resolveDeferredStackAction } from "../src/legal/stack-resolution-core";
import {
  checkAndQueueOracleChoices,
  checkAndQueuePlacementOracle,
  resolveOracleMechanic,
  resolvePlacementOracleMechanic,
  wouldQueueOracleChoices,
} from "../src/mechanics/oracle-system";
import type { GameState } from "../src/model";
import { createActiveAttack } from "../src/battle/battle-shared";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const getCardDefinitionById = (id: string) => definitions.get(id);
const lookup = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
};

function fixture(suppressed = true, mirrorOwner = "bob"): GameState {
  const instance = (
    cardNo: string,
    instanceId: string,
    zone: "field" | "trash" | "deck",
    ownerPlayerId = "alice",
    normalCoreCount = 0
  ) =>
    createCardInstance(definitions.get(cardNo)!, {
      instanceId,
      ownerPlayerId,
      zone,
      normalCoreCount,
    });
  return rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ deckCount: 3 }],
        cardInstances: [
          instance("BSTH04-転醒R01(A)", "mirror", "field", mirrorOwner),
          instance("BSSA01-XX01", "cardinal", "field", "alice", 4),
          instance("BSSA01-C01", "trigger", "field", "alice", 1),
          ...[0, 1, 2].map((i) => instance("BSSA01-C01", `deck-${i}`, "deck")),
          ...(suppressed
            ? [instance("BSTH04-C02", "kigen", "trash", mirrorOwner)]
            : []),
        ],
      }),
      activePlayerId: "alice",
      step: "main",
      turnNumber: 5,
    },
    getCardDefinitionById
  );
}

const skills = (state: GameState) =>
  getAvailableDivineSkillLegalActions({
    state,
    actingPlayerId: "alice",
    ...lookup,
  });
const oracle = {
  kind: "oracle",
  grandwalkerInstanceId: "cardinal",
  triggerKind: "summon",
} as const;
const placement = {
  kind: "placement_oracle",
  grandwalkerInstanceId: "cardinal",
} as const;

describe("浄玻璃の鏡の神秘 × カーディナル（Q23201/Q23202）", () => {
  it("アタックステップのフラッシュ神技4も抑止される", () => {
    const flash = (state: GameState): GameState => ({
      ...state,
      step: "attack",
      window: "flash_before_block",
      activeAttack: {
        ...createActiveAttack(state, "attacker", "bob"),
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
          pendingStackAction: null,
        },
      },
    });
    expect(skills(flash(fixture(false)))).toMatchObject([{ skillIndex: 1 }]);
    expect(skills(flash(fixture()))).toEqual([]);
  });

  it.each([5, 7])("%i色の創界神は6色指定の抑止を受けない", (count) => {
    const base = definitions.get("BSSA01-XX01")!;
    const variant = {
      ...base,
      colors:
        count === 5
          ? base.colors.slice(0, 5)
          : [...base.colors, "black" as const],
    };
    const getVariant = (id: string) =>
      id === base.cardNo ? variant : getCardDefinitionById(id);
    const state = recomputeAndRebuildContinuousEffects(fixture(), getVariant);
    expect(
      getAvailableDivineSkillLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: getVariant,
      })
    ).toHaveLength(1);
    expect(
      resolveOracleMechanic(
        state,
        oracle,
        "alice",
        true,
        getVariant
      ).cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(5);
  });

  it("神託だけを指定した抑止では神技を使用できる", () => {
    const state = fixture();
    state.activeContinuousEffects = state.activeContinuousEffects.map((ce) =>
      ce.modifierTag === "effect_suppression"
        ? {
            ...ce,
            metadata: {
              ...ce.metadata,
              effectFilter: { timingKind: "triggered", keywords: ["oracle"] },
            },
          }
        : ce
    );
    expect(skills(state)).toHaveLength(1);
    expect(
      wouldQueueOracleChoices(state, "trigger", "summon", getCardDefinitionById)
    ).toBe(false);
  });

  it("鏡の効果を受けない創界神は神技・神託を発揮できる（Q23197）", () => {
    const base = fixture();
    const state: GameState = {
      ...base,
      activeContinuousEffects: [
        ...base.activeContinuousEffects,
        {
          effectId: "test-nexus-immunity",
          sourceInstanceId: "cardinal",
          sourceDefinitionId: "BSSA01-XX01",
          actingPlayerId: "alice",
          targetInstanceId: "cardinal",
          modifierTag: "defense_immune",
          duration: { scope: "turn" },
          createdAtTurn: 5,
          createdAtAttackId: null,
          immunityPlayerScope: "opponent",
          immunitySourceScope: { categories: ["nexus"] },
        },
      ],
    };
    expect(skills(state)).toHaveLength(1);
    expect(
      wouldQueueOracleChoices(state, "trigger", "summon", getCardDefinitionById)
    ).toBe(true);
  });

  it.each(["alice", "bob"])(
    "%sの鏡が6色創界神の神技を抑止し、条件消失で再び使える",
    (owner) => {
      const state = fixture(true, owner);
      expect(skills(fixture(false, owner))).toHaveLength(1);
      expect(skills(state)).toHaveLength(0);
      expect(
        state.activeContinuousEffects.some(
          (ce) =>
            ce.sourceInstanceId === "cardinal" &&
            ce.modifierTag === "treat_as_symbol_and_reduction"
        )
      ).toBe(true);
      const released = recomputeAndRebuildContinuousEffects(
        {
          ...state,
          cardInstances: state.cardInstances.filter(
            (card) => card.instanceId !== "kigen"
          ),
        },
        getCardDefinitionById
      );
      expect(skills(released)).toHaveLength(1);
    }
  );

  it("抑止前に取得した神技actionも宣言できず、コアと回数を消費しない", () => {
    const action = skills(fixture(false))[0]!;
    const state = fixture();
    expect(() => applyLegalAction({ state, action, ...lookup })).toThrow(
      /suppressed/i
    );
    expect(state.usedDivineSkillKeysThisTurn).toEqual([]);
    expect(
      state.cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(4);
  });

  it("神技宣言後に抑止された場合も、解決でコア支払い・選択・ドローをしない", () => {
    const before = fixture(false);
    const declared = applyLegalAction({
      state: before,
      action: skills(before)[0]!,
      ...lookup,
    }).state;
    const stack = declared.stackWindow!.pendingStackAction!;
    const state = {
      ...fixture(),
      usedDivineSkillKeysThisTurn: declared.usedDivineSkillKeysThisTurn,
    };
    const after = resolveDeferredDivineSkillStack(state, stack, lookup);
    expect(after).toEqual(state);
    expect(after.pendingStepChoice).toBeNull();
  });

  it("神技4の宣言後に抑止されたら転醒対象の選択も出さない", () => {
    const before = fixture(false);
    const declared = applyLegalAction({
      state: before,
      action: { ...skills(before)[0]!, skillIndex: 1, coreCost: 4 },
      ...lookup,
    }).state;
    const stack = declared.stackWindow!.pendingStackAction!;
    const suppressed = fixture();
    const state: GameState = {
      ...suppressed,
      cardInstances: [
        ...suppressed.cardInstances,
        createCardInstance(definitions.get("BSSA01-転醒X01(A)")!, {
          instanceId: "rebirth-target",
          ownerPlayerId: "alice",
          zone: "field",
        }),
      ],
    };
    const after = resolveDeferredStackAction(state, stack, lookup);
    expect(after.pendingEffectTargetSelection).toBeNull();
    expect(after.pendingStepChoice).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(4);
  });

  it("通常神託・配置時神託をキューせず、発火見込みもfalseになる", () => {
    const state = fixture();
    expect(
      checkAndQueueOracleChoices(
        fixture(false),
        "trigger",
        "summon",
        getCardDefinitionById,
        "test:grandwalker-effect-suppression:269"
      ).pendingTriggeredEffects
    ).toHaveLength(1);
    expect(
      checkAndQueuePlacementOracle(
        fixture(false),
        "cardinal",
        getCardDefinitionById,
        "test:grandwalker-effect-suppression:277"
      ).pendingTriggeredEffects
    ).toHaveLength(1);
    expect(
      checkAndQueueOracleChoices(
        state,
        "trigger",
        "summon",
        getCardDefinitionById,
        "test:grandwalker-effect-suppression:284"
      ).pendingTriggeredEffects
    ).toEqual([]);
    expect(
      checkAndQueuePlacementOracle(
        state,
        "cardinal",
        getCardDefinitionById,
        "test:grandwalker-effect-suppression:292"
      ).pendingTriggeredEffects
    ).toEqual([]);
    expect(
      wouldQueueOracleChoices(state, "trigger", "summon", getCardDefinitionById)
    ).toBe(false);
  });

  it("神託の解決直前に抑止されたらコアもデッキも変わらない", () => {
    const state = fixture();
    expect(
      resolveOracleMechanic(state, oracle, "alice", true, getCardDefinitionById)
    ).toEqual(state);
    expect(
      resolvePlacementOracleMechanic(state, placement, getCardDefinitionById)
    ).toEqual(state);
    const allowed = resolveOracleMechanic(
      fixture(false),
      oracle,
      "alice",
      true,
      getCardDefinitionById
    );
    expect(
      allowed.cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(5);
    const placed = resolvePlacementOracleMechanic(
      fixture(false),
      placement,
      getCardDefinitionById
    );
    expect(
      placed.cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(7);
    expect(placed.players[0]!.deckCount).toBe(0);
  });

  it("キュー済み神託は抑止後にスキップだけとなり、窓を開かずに除去できる", () => {
    const queued = checkAndQueueOracleChoices(
      fixture(false),
      "trigger",
      "summon",
      getCardDefinitionById,
      "test:grandwalker-effect-suppression:332"
    );
    const state = {
      ...fixture(),
      pendingTriggeredEffects: queued.pendingTriggeredEffects,
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...lookup,
    }).find((a) => a.kind === "resolve_pending_triggered_effect");
    expect(action).toMatchObject({ skipOnly: true });
    const after = applyLegalAction({ state, action: action!, ...lookup }).state;
    expect(after.pendingTriggeredEffects).toEqual([]);
    expect(after.stackWindow).toBeNull();
    expect(
      after.cardInstances.find((card) => card.instanceId === "cardinal")
        ?.normalCoreCount
    ).toBe(4);
    expect(after.players[0]!.deckCount).toBe(3);
  });
});
