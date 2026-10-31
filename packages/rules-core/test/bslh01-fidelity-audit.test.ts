import { executeEffectWithChosenMinimumCores } from "./helpers/core-choice-driver";
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getEffectiveLevel,
  getLegalActions,
  type Effect,
  type GameState,
} from "../src";
import {
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";
import { finalizeEffectResolution } from "../src/effect/effect-resolution";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { getAvailableTriggeredEffectSourceChoices } from "../src/effect/trigger-system";
import { flushPendingLeaves } from "../src/state-based-actions";
import { isCardImmuneToOpponentEffect } from "../src/effect/effect-resistance-check";
import { setQuartz } from "../src/mechanics/quartz-system";
import {
  confirmAttackDeclarationAsAction,
  useAttackAsAction,
} from "../src/battle/battle-actions";
import { rebuildContinuousEffectsFromField } from "../src/effect/continuous-effect-rebuild";
import { getBlockDeclarationBlockReason } from "../src/battle/battle-availability";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const get = (id: string) => definitions.find((c) => c.cardNo === id);
const card = (no: string) => get(`BSLH01-${no}`)!;
const lookups = {
  getCardDefinitionById: get,
  getRegisteredTriggeredEffectActions: () => [],
};
function instance(
  no: string,
  id: string,
  owner = "a",
  zone: "field" | "hand" | "deck" | "trash" = "field",
  cores = 1
) {
  return createCardInstance(card(no), {
    instanceId: id,
    ownerPlayerId: owner,
    controllerPlayerId: owner,
    zone,
    normalCoreCount: cores,
  });
}
function act(state: GameState, kind: string, extra: object = {}) {
  const action = getLegalActions({
    state,
    actingPlayerId: "a",
    getRegisteredFieldCardEffectActions: () => undefined,
    ...lookups,
  }).find((a) => a.kind === kind);
  expect(action, kind).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...extra })
    .state;
}
function drain(state: GameState) {
  for (let i = 0; i < 20; i++) {
    if (state.pendingStepOptionalChoice) {
      state = act(state, "resolve_pending_step_optional_choice");
    } else if (state.pendingAfterTriggersContinuations.length) {
      const finalized = finalizeEffectResolution({
        state,
        beforeState: state,
        chainId: state.pendingAfterTriggersContinuations[0]!.waitChainId,
        endLogs: [],
        ...lookups,
        getRegisteredBurstActions: undefined,
        causedBySourceInstanceId: null,
      });
      const next = resumeStackCascadeIfReady(finalized, {
        ...lookups,
        getRegisteredBurstActions: () => [],
      });
      if (next === state) break;
      state = next;
    } else break;
  }
  return state;
}
function increaseLevel(state: GameState) {
  const effect: Effect = {
    timing: { kind: "activated", mode: "main" },
    steps: [
      {
        action: {
          kind: "override_properties",
          target: { kind: "self" },
          properties: { level: { delta: 1 } },
          duration: { scope: "turn" },
        },
      },
    ],
  };
  return executeEffect({
    chainId: "test:bslh01-fidelity-audit:96",
    ...lookups,
    state,
    effect,
    sourceInstanceId: "source",
    actingPlayerId: "a",
  });
}
describe("BSLH01 全文監査の実盤面回帰", () => {
  it.each([1, "all"] as const)(
    "T17 は対象数 %s の相手効果への対象化・包含を防ぎ、免疫は付与しない",
    (count) => {
      const state = createEmptyGameState({
        playerIds: ["a", "b"],
        cardInstances: [
          instance("T17", "source", "a", "field", 0),
          instance("C01", "cb"),
          instance("C04", "enemy", "b"),
        ],
      });
      state.step = "attack";
      const protectedState = executeEffect({
        chainId: "test:bslh01-fidelity-audit:117",
        ...lookups,
        state,
        effect: card("T17").effects![1]!,
        effectIndex: 1,
        sourceInstanceId: "source",
        actingPlayerId: "a",
      });
      const cb = protectedState.cardInstances.find(
        (c) => c.instanceId === "cb"
      )!;
      expect(
        isCardImmuneToOpponentEffect(
          protectedState,
          cb,
          "b",
          "none",
          { instance: state.cardInstances[2], definition: card("C04") },
          get
        )
      ).toBe(false);
      const effect: Effect = {
        timing: { kind: "activated", mode: "flash" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count,
              },
            },
          },
        ],
      };
      const after = flushPendingLeaves(
        executeEffect({
          chainId: "test:bslh01-fidelity-audit:155",
          ...lookups,
          state: protectedState,
          effect,
          sourceInstanceId: "enemy",
          actingPlayerId: "b",
        }),
        get
      );
      expect(after.cardInstances.find((c) => c.instanceId === "cb")?.zone).toBe(
        "field"
      );
    }
  );
  it("TR01B のクォーツは CB のアタック中だけコスト4以下のブロックを禁止する", () => {
    const state = createEmptyGameState({
      playerIds: ["a", "b"],
      cardInstances: [
        instance("CX01", "host", "a", "field", 0),
        instance("TR01(B)", "quartz", "a", "hand", 0),
        instance("C01", "attacker"),
        instance("C04", "low", "b"),
        instance("X10", "high", "b"),
      ],
    });
    state.players[0]!.soulStateInstanceIds = ["host"];
    state.cardInstances[1]!.originalDefinitionId = "BSLH01-TR01(A)";
    state.step = "attack";
    state.turnNumber = 2;
    const set = setQuartz(
      state,
      {
        quartzInstanceId: "quartz",
        hostInstanceId: "host",
        ownerPlayerId: "a",
        slot: "left",
      },
      get
    )!;
    expect(set).not.toBeNull();
    const before = rebuildContinuousEffectsFromField(set, get);
    const declaring = useAttackAsAction({
      ...lookups,
      state: before,
      sourceInstanceId: "attacker",
      actingPlayerId: "a",
    });
    const confirmed = confirmAttackDeclarationAsAction(
      declaring.preDeclarationStackWindow!,
      declaring,
      lookups
    ).state;
    const after = rebuildContinuousEffectsFromField(confirmed, get, {
      unsafeAllowDuringBattle: true,
    });
    expect(
      before.activeContinuousEffects.some(
        (c) => c.sourceInstanceId === "quartz" && c.targetInstanceId === "low"
      )
    ).toBe(false);
    expect(after.activeAttack).not.toBeNull();
    const blockWindow: GameState = {
      ...after,
      window: "declare_block",
      activeAttack: {
        ...after.activeAttack!,
        flashWindowState: null,
        flashBeforeBlockCompleted: true,
      },
    };
    const canBlock = (sourceInstanceId: string) =>
      getBlockDeclarationBlockReason({
        state: blockWindow,
        sourceInstanceId,
        participantEntityId: blockWindow.activeAttack!.primaryEntityId,
        actingPlayerId: "b",
        getCardDefinitionById: get,
      });
    expect(canBlock("low")).toBe("source_not_ready");
    expect(canBlock("high")).toBeNull();
  });
  it("C14 は取得選択前に公開スピリット数のコアを導界者へ置き、通常ネクサスには置かない", () => {
    const state = createEmptyGameState({
      playerIds: ["a", "b"],
      cardInstances: [
        instance("C14", "source", "a", "hand", 0),
        instance("X01", "guided", "a", "field", 0),
        instance("C12", "ordinary"),
        instance("C01", "deck1", "a", "deck", 0),
        instance("C04", "deck2", "a", "deck", 0),
        instance("C14", "deck3", "a", "deck", 0),
      ],
    });
    const after = executeEffect({
      chainId: "test:bslh01-fidelity-audit:248",
      ...lookups,
      state,
      effect: card("C14").effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "source",
      actingPlayerId: "a",
    });
    expect(after.pendingDeckReveal?.phase).toBe("picking");
    expect(
      after.cardInstances.filter((c) => c.zone === "revealed")
    ).toHaveLength(3);
    expect(
      after.cardInstances.find((c) => c.instanceId === "guided")
        ?.normalCoreCount
    ).toBe(2);
    expect(
      after.cardInstances.find((c) => c.instanceId === "ordinary")
        ?.normalCoreCount
    ).toBe(1);
    expect(after.players[0]!.handCount).toBe(state.players[0]!.handCount);
  });
  it("T06 は実効 Lv4 なら大粉砕で 20 枚破棄する", () => {
    const state = increaseLevel(
      createEmptyGameState({
        playerIds: ["a", "b"],
        cardInstances: [
          instance("T06", "source"),
          ...Array.from({ length: 25 }, (_, i) =>
            instance("C02", `deck${i}`, "b", "deck", 0)
          ),
        ],
      })
    );
    expect(
      getEffectiveLevel(state, state.cardInstances[0]!, card("T06"), get)
    ).toBe(4);
    const after = executeEffect({
      chainId: "test:bslh01-fidelity-audit:285",
      ...lookups,
      state,
      effect: card("T06").effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "source",
      actingPlayerId: "a",
    });
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === "b" && c.zone === "trash"
      )
    ).toHaveLength(20);
    expect(
      after.cardInstances.filter(
        (c) => c.ownerPlayerId === "b" && c.zone === "deck"
      )
    ).toHaveLength(5);
  });
  it("X09 は実効 Lv4 なら同じ生存対象から 2 個を 4 回除去する", () => {
    const source = {
      ...instance("X09", "source", "a", "field", 5),
      soulCoreCount: 1,
    };
    let state = createEmptyGameState({
      playerIds: ["a", "b"],
      cardInstances: [source, instance("C04", "enemy", "b", "field", 10)],
    });
    state.players[0]!.soulCoreLocation = { kind: "card", instanceId: "source" };
    state = increaseLevel(state);
    expect(
      getEffectiveLevel(state, state.cardInstances[0]!, card("X09"), get)
    ).toBe(4);
    const after = executeEffect({
      chainId: "test:bslh01-fidelity-audit:318",
      ...lookups,
      state,
      effect: card("X09").effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "source",
      actingPlayerId: "a",
    });
    expect(
      after.cardInstances.find((c) => c.instanceId === "enemy")?.normalCoreCount
    ).toBe(2);
    expect(after.players[1]!.trashNormalCoreCount).toBe(8);
  });
  it("X10 はバースト召喚後に任意 SD でソウルコアを除外し赤シンボルを追加する", () => {
    const state = createEmptyGameState({
      playerIds: ["a", "b"],
      playerOverrides: [
        { reserveSoulCoreCount: 1, soulCoreLocation: { kind: "reserve" } },
        {},
      ],
      cardInstances: [instance("X10", "source", "a", "hand", 0)],
    });
    const after = drain(
      executeEffectWithChosenMinimumCores({
        chainId: "test:bslh01-fidelity-audit:341",
        ...lookups,
        state,
        effect: card("X10").effects![0]!,
        effectIndex: 0,
        sourceInstanceId: "source",
        actingPlayerId: "a",
        choiceIndex: 0,
      })
    );
    expect(
      after.cardInstances.find((c) => c.instanceId === "source")?.zone
    ).toBe("field");
    expect(after.players[0]!.soulCoreLocation).toEqual({
      kind: "removed_from_game",
    });
    expect(after.activeContinuousEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetInstanceId: "source",
          modifierTag: "symbol_addition",
        }),
      ])
    );
  });
  it.each(["destroy", "bounce", "vanish", "remove_from_game"] as const)(
    "TR01B の相手 %s に対する任意離脱置換の候補を原文どおりに限定する",
    (eventKind) => {
      const source = instance("TR01(B)", "source");
      source.originalDefinitionId = "BSLH01-TR01(A)";
      source.pendingLeaveKind = eventKind;
      source.pendingLeaveCause = "effect";
      const state = createEmptyGameState({
        playerIds: ["a", "b"],
        cardInstances: [source, instance("C01", "lloyd", "a", "hand", 0)],
      });
      const choices = getAvailableTriggeredEffectSourceChoices({
        state,
        pendingEffect: {
          pendingId: "noel-leave",
          actingPlayerId: "a",
          eventKind,
          event: {
            family: "leave_field",
            causeKind: eventKind,
            cause: "opponent_effect",
          },
          source: "action_resolution",
          chainId: "test:bslh01-fidelity-audit:379",
          attackId: null,
          relatedPlayerId: "a",
          relatedInstanceId: "source",
          amount: null,
          step: "main",
          window: "main_open",
          resolvedSourceInstanceIds: [],
          cause: "opponent_effect",
        },
        getCardDefinitionById: get,
        getRegisteredTriggeredEffectActions:
          buildTriggeredEffectLookup(definitions),
      });
      expect(choices.some((c) => c.sourceCard.instanceId === "source")).toBe(
        eventKind === "destroy" || eventKind === "bounce"
      );
    }
  );
  it("TR01B は手札のロイドを公開したうえで裏返して無料召喚できる", () => {
    const state = createEmptyGameState({
      playerIds: ["a", "b"],
      cardInstances: [
        instance("TR01(B)", "source"),
        instance("C01", "lloyd", "a", "hand", 0),
      ],
    });
    state.cardInstances[0]!.originalDefinitionId = "BSLH01-TR01(A)";
    let after = drain(
      executeEffect({
        chainId: "test:bslh01-fidelity-audit:418",
        ...lookups,
        state,
        effect: card("TR01(B)").effects![1]!,
        effectIndex: 1,
        sourceInstanceId: "source",
        actingPlayerId: "a",
        choiceIndex: 1,
      })
    );
    expect(after.pendingReverseRebirthSummon?.costToPay).toBe(0);
    after = act(after, "resolve_reverse_rebirth_summon", {
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });
    after = flushPendingLeaves(after, get);
    expect(
      after.cardInstances.some(
        (c) => c.definitionId === "BSLH01-TR01(A)" && c.zone === "field"
      )
    ).toBe(true);
    expect(after.log.some((s) => s.includes("reveal_hand"))).toBe(true);
  });
});
