import { backfillOptionalStateFields } from "../src/state-sanitize";
import { expect, it } from "vitest";
import { BSDB01_CARDS as cards } from "../../card-data/src/cards/BSDB01";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
} from "@orica/rules-core";

const getCardDefinitionById = (id) => cards.find((c) => c.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
  getRegisteredBurstActions: () => undefined,
};
function card(no, instanceId, zone, normalCoreCount = 0) {
  return createCardInstance(getCardDefinitionById("BSDB01-" + no), {
    instanceId,
    ownerPlayerId: "alice",
    zone,
    normalCoreCount,
  });
}
it.each([
  ["field", false],
  ["soul_state", false],
  ["field", true],
])(
  "真バディ host=%s legacy=%s: C07が誘発し、2枚引いた後に1枚破棄する",
  (hostMode, legacy) => {
    let state = rebuildContinuousEffectsFromField(
      {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          startingDeckCount: 3,
          cardInstances: [
            card("CX01", "host", "field", hostMode === "field" ? 1 : 0),
            card("C01", "goku", "hand"),
            card("C07", "capsule", "field"),
            card("C07", "second-capsule", "field"),
            card("C08", "discard", "hand"),
            ...[1, 2, 3].map((n) => card("C09", "deck-" + n, "deck")),
          ],
          playerOverrides: [
            {
              countValue: 0,
              soulCoreLocation: { kind: "reserve" },
              reserveNormalCoreCount: 2,
              contractCardNo: "BSDB01-CX01",
              soulStateInstanceIds: hostMode === "soul_state" ? ["host"] : [],
            },
            {},
          ],
        }),
        step: "main",
        window: "none",
        activePlayerId: "alice",
        turnNumber: 3,
      },
      getCardDefinitionById
    );
    const legal = (player = "alice") =>
      getLegalActions({ state, actingPlayerId: player, ...lookups });
    const apply = (action, extra = {}) => {
      expect(
        action,
        JSON.stringify(legal().map((a) => [a.kind, a.sourceInstanceId]))
      ).toBeDefined();
      state = applyLegalAction({ state, action, ...lookups, ...extra }).state;
    };

    apply(
      legal().find(
        (a) =>
          a.kind === "declare_advent" &&
          a.sourceInstanceId === "goku" &&
          a.candidateTargetInstanceIds.includes("host")
      )
    );
    let passes = 0;
    while (state.stackWindow) {
      expect(passes++).toBeLessThan(20);
      apply(
        legal(state.stackWindow.priorityPlayerId).find(
          (a) => a.kind === "pass_stack"
        )
      );
    }
    const pending = state.pendingAsIfSoulCoreChoice;
    expect(pending).toBeTruthy();
    const choice = pending.options.find(
      (o) => o.proxySourceInstanceId === "host" && o.useAlternateCost
    );
    expect(choice).toBeDefined();
    apply(
      legal().find(
        (a) =>
          a.kind === "resolve_pending_as_if_soul_core_choice" &&
          a.choiceId === choice.choiceId
      )
    );
    apply(
      legal().find((a) => a.kind === "resolve_pending_effect_target"),
      { targetInstanceIds: ["host"] }
    );
    expect(
      state.cardInstances.find((c) => c.instanceId === "goku")
    ).toMatchObject({
      zone: "field",
      underCards: [{ role: "advent_source", cardInstanceId: "host" }],
    });
    expect(
      state.log.some((line) =>
        line.includes("host_dual_advent:host:occupant:goku:alternate_cost")
      )
    ).toBe(true);
    if (state.pendingCoreDistribution) {
      apply(
        legal().find((a) => a.kind === "resolve_pending_core_distribution"),
        {
          coreDistributionAllocations: { goku: 1 },
          coreDistributionSourceAllocations: { reserve: 1 },
        }
      );
      expect(state.pendingCoreDistribution).toBeFalsy();
    }
    expect(
      state.pendingTriggeredEffects.some(
        (e) => e.effectScope === "contract_advent"
      )
    ).toBe(true);
    if (legacy) {
      const saved = JSON.parse(JSON.stringify(state));
      const pending = saved.pendingTriggeredEffects.find(
        (entry) => entry.effectScope === "contract_advent"
      );
      const legacyKeys = <T>(map: Record<string, T>) =>
        Object.fromEntries(
          Object.entries(map).map(([key, value]) => [
            key.replace(/#0$/, "#1"),
            value,
          ])
        );
      pending.timingSourceRegistrations = legacyKeys(
        pending.timingSourceRegistrations
      );
      pending.relatedInstanceIdsBySourceRegistrationKey = legacyKeys(
        pending.relatedInstanceIdsBySourceRegistrationKey
      );
      state = backfillOptionalStateFields(saved);
    }
    const drain = () => {
      for (let i = 0; i < 20; i++) {
        const actions = state.stackWindow
          ? legal(state.stackWindow.priorityPlayerId)
          : legal();
        const action = actions.find(
          (a) =>
            a.kind === "pass_stack" || a.kind === "resolve_pending_burst_check"
        );
        if (!action) return;
        apply(action);
      }
      throw new Error("stack did not close");
    };
    drain();
    const canResolveSecondCapsule = () =>
      legal().some(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          !a.skipOnly &&
          a.sourceInstanceId === "second-capsule"
      );
    expect(canResolveSecondCapsule()).toBe(true);
    apply(
      legal().find(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          !a.skipOnly &&
          a.sourceInstanceId === "capsule"
      )
    );
    drain();
    expect(
      state.cardInstances.filter(
        (c) => c.zone === "hand" && c.instanceId.startsWith("deck-")
      )
    ).toHaveLength(2);
    const discard = legal().find(
      (a) =>
        a.kind === "resolve_pending_zone_selection" &&
        a.actionKind === "discard_hand"
    );
    expect(discard?.canSkip).toBe(false);
    apply(discard, { selectedZoneCardIds: ["discard"] });
    expect(canResolveSecondCapsule()).toBe(false);
    expect(
      state.cardInstances.find((c) => c.instanceId === "discard")?.zone
    ).toBe("trash");
    expect(
      state.semanticTriggerEvents?.filter(
        (e) => e.eventKind === "advent" && e.relatedInstanceId === "goku"
      )
    ).toHaveLength(1);
  }
);
