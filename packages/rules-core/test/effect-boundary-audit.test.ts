import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import {
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
} from "../src/effect/structured-effect-registrations";
import {
  collectAndQueueTriggerReactions,
  getAvailableTriggeredEffectSourceChoices,
} from "../src/effect/trigger-system";
import { flushPendingLeaves } from "../src/state-based-actions";
import { pruneUnavailableBattleImmediateEffects } from "../src/legal/legal-actions-availability";
import type { CardDefinition } from "../src/model";

const map = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const nexus: CardDefinition = {
  ...map.get("BSTH04-C01")!,
  cardNo: "TEST-LEAVE-NEXUS",
  printedCategory: "nexus",
  effects: [],
};

describe("発揮境界の全監査回帰", () => {
  it("BSAZ01-C06 は破壊待機では戻らず、実移動後にだけ手札回収を提示する", () => {
    const c06 = map.get("BSAZ01-C06")!;
    const defs = [c06, nexus];
    const deps = {
      getCardDefinitionById: (id: string) =>
        defs.find((def) => def.cardNo === id),
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
      getRegisteredBurstActions: () => [],
    };
    const before = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(c06, {
          instanceId: "observer",
          ownerPlayerId: "alice",
          zone: "trash",
        }),
        createCardInstance(nexus, {
          instanceId: "target",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(nexus, {
          instanceId: "source",
          ownerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    });
    const after = executeEffect({
      chainId: "test:effect-boundary-audit:57",
      state: before,
      sourceInstanceId: "source",
      actingPlayerId: "bob",
      ...deps,
      targetInstanceIds: ["target"],
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "destroy",
              target: {
                kind: "filter",
                player: "opponent",
                filter: { category: ["nexus"] },
                count: 1,
              },
            },
          },
        ],
      },
    });
    const collect = (beforeState: typeof before, afterState: typeof before) =>
      collectAndQueueTriggerReactions({
        beforeState,
        afterState,
        source: "action_resolution",
        chainId: "past-leave",
        causedByPlayerId: "bob",
        causedBySourceInstanceId: "source",
        ...deps,
      });
    const waiting = collect(before, after);
    expect(waiting.pendingPrivateDeclarations).toHaveLength(0);
    expect(waiting.pendingTriggeredEffects).toHaveLength(0);
    expect(
      waiting.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("field");
    const moved = collect(
      waiting,
      flushPendingLeaves(waiting, deps.getCardDefinitionById)
    );
    expect(
      moved.cardInstances.find((c) => c.instanceId === "target")?.zone
    ).toBe("trash");
    const pending = moved.pendingTriggeredEffects.find(
      (p) => p.eventKind === "leave_field"
    );
    expect(pending).toBeDefined();
    expect(
      getAvailableTriggeredEffectSourceChoices({
        state: moved,
        pendingEffect: pending!,
        ...deps,
      }).map((choice) => choice.sourceCard.instanceId)
    ).toEqual(["observer"]);
  });

  it.each([false, true])(
    "アタック時も、対象不在なら保持、発揮条件未達なら除去（条件=%s）",
    (conditional) => {
      const source: CardDefinition = {
        ...nexus,
        cardNo: "TEST-ATTACK-ELIGIBILITY",
        printedCategory: "spirit",
        effects: [
          {
            timing: { kind: "card_event", event: "attack" },
            ...(conditional
              ? {
                  condition: [
                    {
                      kind: "field_has" as const,
                      player: "self" as const,
                      cardNames: [{ exact: "不在の条件カード" }],
                    },
                  ],
                }
              : {}),
            steps: [
              {
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
            ],
          },
        ],
      };
      const state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(source, {
            instanceId: "source",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
        ],
      });
      state.battleImmediateEffects = [
        {
          promptId: "attack-prompt",
          attackId: "test-attack",
          actingPlayerId: "alice",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "source",
          sourceDefinitionId: source.cardNo,
          sourceCardNo: source.cardNo,
          registrationIndex: 0,
          participantEntityId: "battle-entity:source",
        },
      ];
      const after = pruneUnavailableBattleImmediateEffects({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: (id) =>
          id === source.cardNo ? source : undefined,
        getRegisteredBattleImmediateEffectActions:
          buildBattleImmediateEffectLookup([source]),
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredTriggeredEffectActions: () => [],
      });
      expect(after.battleImmediateEffects).toHaveLength(conditional ? 0 : 1);
    }
  );
});
