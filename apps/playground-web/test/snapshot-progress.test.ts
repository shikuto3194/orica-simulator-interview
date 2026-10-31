import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "@orica/card-data";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  getLegalActions,
  sanitizeStateForViewer,
} from "@orica/rules-core";
import { expandCardDefinitionsWithBackFaces } from "../../../packages/rules-core/src/effect/structured-effect-registrations";
import { buildSnapshotProgressScenario } from "../src/scenario-snapshot-progress";
const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const deps = {
  getCardDefinitionById: (id: string) =>
    definitions.find((c) => c.cardNo === id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};
describe("snapshot progress", () => {
  it.each(["alice", "bob"])(
    "%s: delivered brave choices finish the attack step",
    (owner) => {
      const raw = buildSnapshotProgressScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      expect(raw.pendingBraveLeaveChoice).not.toBeNull();
      const state = sanitizeStateForViewer(raw, owner);
      expect(state.pendingPromptLock?.resolverPlayerIds).toEqual([owner]);
      const actions = getLegalActions({
        state,
        actingPlayerId: owner,
        ...deps,
      }).filter((a) => a.kind === "resolve_brave_leave_choice");
      expect(actions).toHaveLength(2);
      for (const action of actions) {
        const result = applyLegalAction({ state, action, ...deps }).state;
        expect(result.pendingLeaveEntities).toEqual([]);
        expect(result.pendingAttackStepEndFinalizations).toEqual([]);
        expect(result.step).toBe("end");
        expect(result.pendingPromptLock).toBeNull();
      }
    }
  );
  it("two declared drives retain the second immediate action beside the normal rebirth effect", () => {
    const state = buildSnapshotProgressScenario(
      ALL_CARDS,
      new URLSearchParams({ mode: "drives", stage: "after-first" })
    );
    expect(state.pendingTriggeredEffects).toHaveLength(2);
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      ...deps,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "resolve_pending_triggered_effect",
      sourceInstanceId: "drive-2",
      executionMode: "mandatory",
    });
  });
  it.each(["alice", "bob"])(
    "%s: another player cannot consume the delivered choice lock",
    (owner) => {
      const opponent = owner === "alice" ? "bob" : "alice";
      const raw = buildSnapshotProgressScenario(
        ALL_CARDS,
        new URLSearchParams({ owner })
      );
      const action = getLegalActions({
        state: raw,
        actingPlayerId: owner,
        ...deps,
      })[0]!;
      const opponentView = sanitizeStateForViewer(raw, opponent);
      expect(opponentView.pendingBraveLeaveChoice).toBeNull();
      expect(
        getLegalActions({
          state: opponentView,
          actingPlayerId: opponent,
          ...deps,
        })
      ).toEqual([]);
      expect(() =>
        applyLegalAction({
          state: opponentView,
          action: { ...action, actingPlayerId: opponent },
          ...deps,
        })
      ).toThrow("another player's choice");
      expect(opponentView.pendingPromptLock?.resolverPlayerIds).toEqual([
        owner,
      ]);
    }
  );
  it.each(["dioscuria", "siren"])(
    "%s: second declared drive resolves or fizzles before normal effects",
    (hostKind) => {
      let state = buildSnapshotProgressScenario(
        ALL_CARDS,
        new URLSearchParams({ mode: "drives", host: hostKind })
      );
      const host = () =>
        state.cardInstances.find((c) => c.instanceId === "host")!;
      const coresBefore = host().normalCoreCount;
      const handBefore = state.players[0]!.handCount;
      const resolve = getLegalActions({
        state,
        actingPlayerId: "alice",
        ...deps,
      }).find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "drive-2"
      )!;
      expect(
        resolve,
        JSON.stringify({
          pending: state.pendingTriggeredEffects,
          actions: getLegalActions({ state, actingPlayerId: "alice", ...deps }),
        })
      ).toBeDefined();
      state = applyLegalAction({ state, action: resolve, ...deps }).state;
      const pass = getLegalActions({
        state,
        actingPlayerId: "bob",
        ...deps,
      }).find((a) => a.kind === "pass_stack")!;
      state = applyLegalAction({ state, action: pass, ...deps }).state;
      expect(host().underCards).toHaveLength(hostKind === "siren" ? 1 : 3);
      expect(host().normalCoreCount).toBe(
        coresBefore + (hostKind === "siren" ? 0 : 1)
      );
      // 成功時は下置きで1枚減り、ドローで1枚増える。不発時は双方なし。
      expect(state.players[0]!.handCount).toBe(handBefore);
      expect(
        state.cardInstances.find((c) => c.instanceId === "drive-2")?.zone
      ).toBe(hostKind === "siren" ? "hand" : "field");
      expect(
        state.pendingTriggeredEffects.every((p) => !p.declaredFromPrivateZone)
      ).toBe(true);
      expect(
        getLegalActions({ state, actingPlayerId: "alice", ...deps }).some(
          (a) => "sourceInstanceId" in a && a.sourceInstanceId === "host"
        )
      ).toBe(true);
    }
  );
});
