import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { executeEffectResistance } from "../src/effect/structured-effect-interpreter";
import { buildTriggeredEffectLookup } from "../src/effect/structured-effect-registrations";
import type { CardDefinition } from "../src/model";
import type { Effect } from "../src/dsl-types";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
  pruneIllegalPendingTriggeredEffects,
} from "../src/effect/trigger-system";
import { executeStayOnField } from "../src/effect/structured-state-grants";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookup = (id: string): CardDefinition | undefined => definitions.get(id);
const triggered = buildTriggeredEffectLookup(ALL_CARDS);
const komachi = definitions.get("BSTH04-X03")!;
const kenshin = definitions.get("BSRK01-CX01")!;
function setup() {
  return createEmptyGameState({
    playerIds: ["alice", "bob"],
    startingVoidNormalCoreCount: 20,
    playerOverrides: [{}, { contractCardNo: "BSRK01-CX01" }],
    cardInstances: [
      createCardInstance(komachi, {
        instanceId: "source",
        ownerPlayerId: "alice",
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(kenshin, {
        instanceId: "target",
        ownerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
    ],
  });
}

describe("同一効果の離脱成立は残留・魂状態選択より先", () => {
  it.each(["destroy", "vanish"] as const)(
    "別効果の%s/離れるとき誘発は、残る解決前だけ待機状態を参照できる",
    (kind) => {
      const observer: CardDefinition = {
        ...komachi,
        effects: [
          {
            timing: {
              kind: "game_event",
              event: [kind, "leave_field"],
              player: "opponent",
              sourceWhose: "either",
            },
            steps: [
              { action: { kind: "count_increase", amount: 1, player: "self" } },
            ],
          },
        ],
      };
      const defs = [observer, kenshin];
      const getCardDefinitionById = (id: string) =>
        defs.find((d) => d.cardNo === id);
      const getRegisteredTriggeredEffectActions =
        buildTriggeredEffectLookup(defs);
      const deps = {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: () => [],
      };
      for (const cannotLeave of [false, true]) {
        let before = setup();
        if (cannotLeave)
          before = executeEffectResistance(
            before,
            "bob",
            {
              kind: "effect_resistance",
              target: { selfCard: true, count: 1 },
              resistType: "cannot_leave_field",
              source: "opponent_effect",
              duration: { scope: "turn" },
            },
            "target",
            lookup
          );
        const after = executeEffect({
          chainId: "test:inline-leave-outcome:89",
          state: before,
          sourceInstanceId: "source",
          actingPlayerId: "alice",
          ...deps,
          targetInstanceIds: ["target"],
          effect: {
            timing: { kind: "activated", mode: "main" },
            steps: [
              {
                action: {
                  kind,
                  target: {
                    kind: "filter",
                    player: "opponent",
                    filter: { category: ["spirit"] },
                    count: 1,
                  },
                },
              },
            ],
          },
        });
        const queued = collectAndQueueTriggerReactions({
          beforeState: before,
          afterState: after,
          source: "action_resolution",
          chainId: "audit-leave",
          causedByPlayerId: "alice",
          causedBySourceInstanceId: "source",
          ...deps,
        });
        const pending = queued.pendingTriggeredEffects.find(
          (p) => p.eventKind === kind
        );
        if (cannotLeave) {
          expect(pending).toBeUndefined();
          continue;
        }
        expect(
          pending,
          JSON.stringify({
            before: before.pendingLeaveEntities,
            after: after.pendingLeaveEntities,
            pending: queued.pendingTriggeredEffects,
            private: queued.pendingPrivateDeclarations,
            logs: queued.log,
          })
        ).toBeDefined();
        expect(
          getAvailableTriggeredEffectSourceChoices({
            state: queued,
            pendingEffect: pending!,
            ...deps,
          })
        ).toHaveLength(2);
        // 他の内部効果から「残る」を解決しても、古いイベントの資格は復活しない。
        const stayed = executeStayOnField(
          queued,
          "bob",
          { kind: "stay_on_field", target: { selfCard: true, count: 1 } },
          getCardDefinitionById,
          "target"
        );
        expect(
          getAvailableTriggeredEffectSourceChoices({
            state: stayed,
            pendingEffect: pending!,
            ...deps,
          })
        ).toHaveLength(0);
        expect(
          pruneIllegalPendingTriggeredEffects({ state: stayed, ...deps })
            .pendingTriggeredEffects
        ).toHaveLength(0);
        const declared = {
          ...stayed,
          pendingTriggeredEffects: [
            { ...pending!, declaredFromPrivateZone: true },
          ],
        };
        expect(
          pruneIllegalPendingTriggeredEffects({ state: declared, ...deps })
            .pendingTriggeredEffects
        ).toHaveLength(1);
      }
    }
  );
  it.each([false, true])(
    "小町→契約剣心: 離れない=%s でも、誘発を割り込ませず先にコア2個を置く",
    (cannotLeave) => {
      let state = setup();
      if (cannotLeave)
        state = executeEffectResistance(
          state,
          "bob",
          {
            kind: "effect_resistance",
            target: { selfCard: true, count: 1 },
            resistType: "cannot_leave_field",
            source: "opponent_effect",
            duration: { scope: "turn" },
          },
          "target",
          lookup
        );
      const after = executeEffect({
        chainId: "test:inline-leave-outcome:195",
        state,
        effect: komachi.effects[0]!,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: triggered,
        targetInstanceIds: ["target"],
      });
      expect(
        after.cardInstances.find((card) => card.instanceId === "source")
          ?.normalCoreCount
      ).toBe(3);
      expect(after.pendingSoulStateReplacement).toBeNull();
      expect(after.pendingAfterTriggersContinuations).toHaveLength(0);
      expect(after.pendingTriggeredEffects).toHaveLength(0);
      expect(
        after.cardInstances.find((card) => card.instanceId === "target")?.zone
      ).toBe("field");
    }
  );
  it.each(["cannot_leave_field", "cannot_be_destroyed"] as const)(
    "破壊後の数量は %s に応じて成立事実を数える",
    (resistType) => {
      let state = setup();
      state = executeEffectResistance(
        state,
        "bob",
        {
          kind: "effect_resistance",
          target: { selfCard: true, count: 1 },
          resistType,
          source: "opponent_effect",
          duration: { scope: "turn" },
        },
        "target",
        lookup
      );
      const effect: Effect = {
        timing: { kind: "card_event", event: "summon" },
        steps: [
          {
            id: "destroy",
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["spirit"] },
                count: 1,
              },
            },
          },
          {
            connector: "conditional_result",
            action: {
              kind: "count_increase",
              player: "self",
              amount: {
                kind: "dynamic",
                source: { kind: "cards_from_ref", stepId: "destroy" },
              },
            },
          },
        ],
      };
      const after = executeEffect({
        chainId: "test:inline-leave-outcome:261",
        state,
        effect,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        targetInstanceIds: ["target"],
      });
      expect(after.players[0]!.countValue).toBe(
        resistType === "cannot_leave_field" ? 1 : 0
      );
      const repeated = executeEffect({
        chainId: "test:inline-leave-outcome:272",
        state: after,
        effect,
        sourceInstanceId: "source",
        actingPlayerId: "alice",
        getCardDefinitionById: lookup,
        targetInstanceIds: ["target"],
      });
      expect(repeated.players[0]!.countValue).toBe(
        resistType === "cannot_leave_field" ? 2 : 0
      );
      expect(
        after.cardInstances.find((card) => card.instanceId === "target")?.zone
      ).toBe("field");
    }
  );
});
