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
  type LegalAction,
  type SupplementalTriggerEvent,
} from "../src";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
  pruneIllegalPendingTriggeredEffects,
} from "../src/effect/trigger-system";
import { captureTriggerObservation } from "../src/effect/trigger-observation-sources";
import { executeBraveCombine } from "../src/legal/brave-combine-state-helpers";
import type { Effect } from "../src/dsl-types";
const combinedEffect: Effect = {
  timing: { kind: "card_event", event: "exhaust" },
  applicability: { combined: true },
  steps: [
    {
      action: {
        kind: "core_move",
        from: { kind: "void", player: "self" },
        to: { kind: "reserve", player: "self" },
        amount: 2,
      },
    },
  ],
};
const sibling: Effect = {
  timing: { kind: "card_event", event: "exhaust" },
  executionMode: "optional",
  steps: [{ action: { kind: "count_increase", player: "self", amount: 1 } }],
};
const base: CardDefinition = {
  cardNo: "COMBINED-HOST",
  name: "既存本文ホスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  symbolColors: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
  keywordTags: [],
  textLines: [],
  effects: [combinedEffect, sibling],
};
const brave: CardDefinition = {
  ...base,
  cardNo: "LATER-BRAVE",
  name: "後から合体するブレイヴ",
  printedCategory: "brave",
  braveCondition: { minCost: 0 },
  textLines: [
    "【合体中】『このスピリットの疲労時』ボイドからコア2個を自分のリザーブに置く。",
  ],
  effects: [{ ...combinedEffect, textRef: [0] }],
};
function fixture(granted = false) {
  const host = granted ? { ...base, effects: [sibling] } : base;
  const defs = [host, brave];
  const deps = {
    getCardDefinitionById: (id: string) => defs.find((d) => d.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
    getRegisteredBurstActions: () => [],
    getRegisteredFieldCardEffectActions: () => [],
  };
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { voidNormalCoreCount: 20, reserveNormalCoreCount: 0 },
        {},
      ],
      cardInstances: [
        createCardInstance(host, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          exhaustState: "exhausted",
        }),
        createCardInstance(brave, {
          instanceId: "brave",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    }),
    step: "main",
  };
  if (granted)
    state = executeEffect({
      state,
      sourceInstanceId: "host",
      actingPlayerId: "alice",
      chainId: "grant-before-event",
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "grant_effect",
              target: { kind: "self" },
              grantedEffect: combinedEffect,
              duration: { scope: "turn" },
            },
          },
        ],
      },
      ...deps,
    });
  const event: SupplementalTriggerEvent = {
    eventKind: "exhaust",
    source: "action_resolution",
    chainId: "combined-event",
    attackId: null,
    actingPlayerId: "alice",
    relatedPlayerId: "alice",
    relatedInstanceId: "host",
    amount: null,
    observationSnapshot: captureTriggerObservation(state),
  };
  state = collectAndQueueTriggerReactions({
    beforeState: state,
    afterState: state,
    source: "action_resolution",
    chainId: event.chainId,
    supplementalEvents: [event],
    ...deps,
  });
  return { state, deps };
}
type Deps = ReturnType<typeof fixture>["deps"];
function choices(state: GameState, deps: Deps) {
  return state.pendingTriggeredEffects.flatMap((pendingEffect) =>
    getAvailableTriggeredEffectSourceChoices({ state, pendingEffect, ...deps })
  );
}
function act(
  state: GameState,
  deps: Deps,
  predicate: (action: LegalAction) => boolean
) {
  const all = ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...deps })
  );
  const action = all.find(predicate);
  expect(action, JSON.stringify(all)).toBeDefined();
  return applyLegalAction({ state, action: action!, ...deps }).state;
}
function close(state: GameState, deps: Deps) {
  for (let i = 0; state.stackWindow && i < 12; i++)
    state = act(state, deps, (a) => a.kind === "pass_stack");
  return state;
}
describe("合体条件と新規継承の境界", () => {
  it.each([false, true])(
    "既存の%s条件本文は同群途中の合体後に発揮でき、後取得ブレイヴ本文は加わらない",
    (granted) => {
      const f = fixture(granted);
      let state = f.state;
      expect(
        choices(state, f.deps).filter(
          (c) =>
            c.actionRegistration.effectIndex === 0 &&
            c.sourceEffectDefinition.cardNo === base.cardNo
        )
      ).toHaveLength(granted ? 1 : 0);
      if (granted)
        expect(
          state.pendingTriggeredEffects.find(
            (p) => p.mechanic?.kind === "granted_effect"
          )?.dormantMechanic
        ).toBe(true);
      state = executeBraveCombine(
        state,
        "alice",
        "brave",
        "host",
        f.deps.getCardDefinitionById
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "brave")
          ?.attachedToInstanceId
      ).toBe("host");
      state = pruneIllegalPendingTriggeredEffects({ state, ...f.deps });
      expect(
        choices(state, f.deps).some(
          (c) => c.sourceEffectDefinition.cardNo === brave.cardNo
        )
      ).toBe(false);
      const grantedId = state.pendingTriggeredEffects.find(
        (p) => p.mechanic?.kind === "granted_effect"
      )?.pendingId;
      state = close(
        act(
          state,
          f.deps,
          (a) =>
            (a.kind === "resolve_pending_triggered_effect" ||
              a.kind === "select_pending_to_resolve") &&
            (granted
              ? a.pendingId === grantedId
              : a.sourceInstanceId === "host" && a.registrationIndex === 0)
        ),
        f.deps
      );
      if (
        granted &&
        state.pendingTriggeredEffects.some(
          (p) => p.pendingId === grantedId && p.selectedByTurnPlayer
        )
      ) {
        state = close(
          act(
            state,
            f.deps,
            (action) =>
              action.kind === "resolve_pending_triggered_effect" &&
              action.pendingId === grantedId &&
              !action.skipOnly
          ),
          f.deps
        );
      }
      expect(state.players[0]?.reserveNormalCoreCount).toBe(2);
      expect(state.players[0]?.voidNormalCoreCount).toBe(18);
    }
  );
  it("合体前の事象では未取得の継承効果を追加せず、合体後の新事象では取得済みとして観測する", () => {
    const f = fixture();
    const combined = executeBraveCombine(
      f.state,
      "alice",
      "brave",
      "host",
      f.deps.getCardDefinitionById
    );
    expect(
      choices(combined, f.deps).some(
        (c) => c.sourceEffectDefinition.cardNo === brave.cardNo
      )
    ).toBe(false);
    const fresh = { ...combined, pendingTriggeredEffects: [] };
    const event: SupplementalTriggerEvent = {
      eventKind: "exhaust",
      source: "action_resolution",
      chainId: "later-exhaust",
      attackId: null,
      actingPlayerId: "alice",
      relatedPlayerId: "alice",
      relatedInstanceId: "host",
      amount: null,
      observationSnapshot: captureTriggerObservation(fresh),
    };
    const after = collectAndQueueTriggerReactions({
      beforeState: fresh,
      afterState: fresh,
      source: "action_resolution",
      chainId: event.chainId,
      supplementalEvents: [event],
      ...f.deps,
    });
    expect(
      choices(after, f.deps).some(
        (c) => c.sourceEffectDefinition.cardNo === brave.cardNo
      )
    ).toBe(true);
  });
});
