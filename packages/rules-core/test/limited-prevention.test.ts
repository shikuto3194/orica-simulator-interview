import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
} from "../src";
import type { CardDefinition, ContinuousEffectTag } from "../src/model";
import { flushPendingLeaves } from "../src/state-based-actions";

const spirit = ALL_CARDS.find((card) => card.cardNo === "BSTH04.5-X01")!;
const nexus = ALL_CARDS.find((card) => card.cardNo === "BSTH05-X01")!;
const getCardDefinitionById = (id: string) =>
  id === nexus.cardNo ? nexus : ALL_CARDS.find((card) => card.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredFieldCardEffectActions: () => undefined,
  getRegisteredBurstActions: () => undefined,
  getRegisteredMagicActions: () => undefined,
};
const targetIds = ["target-a", "target-b", "target-c"];
function setup(
  source: CardDefinition,
  protectionTags: (ContinuousEffectTag | undefined)[],
  magicZone: "hand" | "trash" = "trash"
) {
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    startingVoidNormalCoreCount: 0,
    playerOverrides: [{ reserveNormalCoreCount: 10 }, {}],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: source.printedCategory === "magic" ? magicZone : "field",
        normalCoreCount: 3,
      }),
      createCardInstance(nexus, {
        instanceId: "nexus",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 4,
      }),
      ...targetIds.map((instanceId) =>
        createCardInstance(spirit, {
          instanceId,
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        })
      ),
    ],
  });
  return {
    ...state,
    activeContinuousEffects: protectionTags.flatMap((modifierTag, index) =>
      modifierTag
        ? [
            {
              effectId: `resistance-${index}`,
              sourceInstanceId: targetIds[index]!,
              sourceDefinitionId: spirit.cardNo,
              actingPlayerId: "bob",
              targetInstanceId: targetIds[index]!,
              duration: { scope: "permanent" as const },
              createdAtTurn: 0,
              createdAtAttackId: null,
              modifierTag,
              metadata: { source: "opponent_effect" },
            },
          ]
        : []
    ),
  };
}

function resolve(
  cardNo: string,
  choiceIndex: number | undefined,
  protectionTags: (ContinuousEffectTag | undefined)[]
) {
  const source = getCardDefinitionById(cardNo)!;
  const effectIndex = source.effects!.findIndex((effect) =>
    effect.steps.some(
      (step) => step.action.kind === "bounce" || step.action.kind === "exhaust"
    )
  );
  const targetCount = choiceIndex === 0 ? 2 : 3;
  return executeEffect({
    ...lookups,
    state: setup(source, protectionTags),
    effect: source.effects![effectIndex]!,
    effectIndex,
    chainId: "test:limited-prevention",
    actingPlayerId: "alice",
    sourceInstanceId: "source",
    targetInstanceIds: targetIds.slice(0, targetCount),
    ...(choiceIndex !== undefined ? { choiceIndex } : {}),
  });
}

describe("「相手は、2体以上防げない」", () => {
  it.each([
    ["BSTH04.5-X01", undefined, "cannot_be_exhausted", "exhausted"],
    ["BSTH05-C11", 0, "cannot_be_bounced", "hand"],
    ["BSTH05-C11", 1, "cannot_be_bounced", "hand"],
    ["BSTH05-C12", 0, "cannot_be_exhausted", "exhausted"],
    ["BSTH05-C12", 1, "cannot_be_exhausted", "exhausted"],
  ] as const)(
    "%s (%s) は防御側が選んだ1体だけを防ぐ",
    (cardNo, choiceIndex, resistance, expected) => {
      const state = resolve(cardNo, choiceIndex, [
        "defense_immune",
        resistance,
        "defense_immune",
      ]);
      expect(
        state.pendingStepChoice?.limitedPrevention?.preventableInstanceIds
      ).toEqual(targetIds.slice(0, choiceIndex === 0 ? 2 : 3));
      expect(
        getLegalActions({ ...lookups, state, actingPlayerId: "alice" })
      ).not.toContainEqual(
        expect.objectContaining({ kind: "resolve_pending_step_choice" })
      );
      const action = getLegalActions({
        ...lookups,
        state,
        actingPlayerId: "bob",
      }).find(
        (candidate) =>
          candidate.kind === "resolve_pending_step_choice" &&
          candidate.choiceIndex === 1
      )!;
      expect(action).toBeDefined();
      const result = applyLegalAction({ ...lookups, state, action });
      const after = flushPendingLeaves(result.state, getCardDefinitionById);
      expect(after.pendingStepChoice).toBeNull();
      const cards = targetIds.map(
        (id) => after.cardInstances.find((card) => card.instanceId === id)!
      );
      const outcomes = cards.map((card) =>
        expected === "hand" ? card.zone : card.exhaustState
      );
      const unchanged = expected === "hand" ? "field" : "recovered";
      expect(outcomes).toEqual(
        choiceIndex === 1
          ? [unchanged, unchanged, unchanged]
          : [expected, unchanged, choiceIndex === 0 ? unchanged : expected]
      );
      expect(
        after.cardInstances.find((card) => card.instanceId === "nexus")
          ?.normalCoreCount
      ).toBe(4);
    }
  );

  it("対象取得禁止を貫通せず、残る耐性が1体なら選択を求めない", () => {
    const after = resolve("BSTH04.5-X01", undefined, [
      "cannot_be_targeted",
      "defense_immune",
      undefined,
    ]);
    expect(after.pendingStepChoice).toBeNull();
    expect(
      targetIds.map(
        (id) =>
          after.cardInstances.find((card) => card.instanceId === id)
            ?.exhaustState
      )
    ).toEqual(["recovered", "recovered", "exhausted"]);
  });
});

it.each([0, 1])(
  "BSTH05-C11 の発揮から耐性持ちを選べる (choice %i)",
  (choiceIndex) => {
    const source = getCardDefinitionById("BSTH05-C11")!;
    const magicLookups = {
      ...lookups,
      getRegisteredMagicActions: buildMagicLookup([source]),
    };
    let state = {
      ...setup(
        source,
        ["defense_immune", "cannot_be_bounced", "defense_immune"],
        "hand"
      ),
      activePlayerId: "alice",
      step: "main" as const,
      window: "default" as const,
    } as import("../src").GameState;
    const legal = (actor = "alice") =>
      getLegalActions({ ...magicLookups, state, actingPlayerId: actor });
    const apply = (
      action: import("../src").LegalAction | undefined,
      extra: Partial<Parameters<typeof applyLegalAction>[0]> = {}
    ) => {
      expect(action).toBeDefined();
      state = applyLegalAction({
        ...magicLookups,
        state,
        action: action!,
        ...extra,
      }).state;
    };

    const use = legal().find((action) => action.kind === "use_magic")!;
    apply(use, {
      paymentSources: [{ kind: "reserve", amount: use.finalCost }],
    });
    for (let i = 0; state.stackWindow && i < 6; i++) {
      apply(
        legal(state.stackWindow.priorityPlayerId).find(
          (action) => action.kind === "pass_stack"
        )
      );
    }
    apply(
      legal().find(
        (action) =>
          action.kind === "resolve_pending_step_choice" &&
          action.choiceIndex === choiceIndex
      )
    );
    const select = legal().find(
      (action) => action.kind === "resolve_pending_effect_target"
    );
    expect(select).toMatchObject({ candidateTargetInstanceIds: targetIds });
    apply(select, {
      targetInstanceIds: targetIds.slice(0, choiceIndex === 0 ? 2 : 3),
    });
    expect(state.pendingStepChoice?.choosingPlayerId).toBe("bob");
    const defense = legal("bob").find(
      (action) =>
        action.kind === "resolve_pending_step_choice" &&
        action.choiceIndex === 0
    );
    apply(defense);
    state = flushPendingLeaves(state, getCardDefinitionById);
    expect(
      targetIds.map(
        (id) => state.cardInstances.find((card) => card.instanceId === id)?.zone
      )
    ).toEqual(
      choiceIndex === 0
        ? ["field", "hand", "field"]
        : ["field", "field", "field"]
    );
  }
);
