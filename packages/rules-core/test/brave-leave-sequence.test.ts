import { describe, expect, it } from "vitest";
import { createCardInstance, createEmptyGameState } from "../src/factories";
import {
  queuePendingLeave,
  flushPendingLeaves,
} from "../src/state-based-actions";
import { applyLegalAction } from "../src/legal/legal-actions-apply";
import { getLegalActions } from "../src/legal/legal-actions";
import type { CardDefinition } from "../src/model";

const hostDef: CardDefinition = {
  cardNo: "TEST-SEQUENCE-HOST",
  name: "離脱するホスト",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  symbolColors: ["red"],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  keywordTags: [],
  textLines: [],
  sourceUrls: [],
  sourceConfidence: "C",
};
const braveDef: CardDefinition = {
  ...hostDef,
  cardNo: "TEST-SEQUENCE-BRAVE",
  name: "残るブレイヴ",
  printedCategory: "brave",
};
const getCardDefinitionById = (id: string) =>
  [hostDef, braveDef].find((d) => d.cardNo === id);

describe("複数ホストのブレイヴ離脱選択", () => {
  for (const count of [2, 3])
    for (const separateChains of [false, true])
      for (const choice of ["keep", "send_with_host"] as const) {
        it(count + "体 / 別チェーン=" + separateChains + " / " + choice, () => {
          const ids = Array.from({ length: count }, (_, i) => i);
          let state = createEmptyGameState({
            playerIds: ["alice", "bob"],
            playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
            cardInstances: ids.flatMap((i) => [
              createCardInstance(hostDef, {
                instanceId: "host-" + i,
                ownerPlayerId: "alice",
                zone: "field",
                normalCoreCount: 2,
                attachedChildrenIds: ["brave-" + i],
              }),
              createCardInstance(braveDef, {
                instanceId: "brave-" + i,
                ownerPlayerId: "alice",
                zone: "field",
                attachedToInstanceId: "host-" + i,
              }),
            ]),
          });
          for (const i of ids)
            state = queuePendingLeave({
              state,
              instanceId: "host-" + i,
              kind: "destroy",
              cause: "effect_resolution",
              chainId: separateChains ? "destroy-" + i : "destroy-all",
            });
          state = flushPendingLeaves(state, getCardDefinitionById);
          for (const i of ids) {
            expect(state.pendingBraveLeaveChoice?.hostInstanceId).toBe(
              "host-" + i
            );
            for (const remaining of ids.slice(i)) {
              expect(
                state.cardInstances.find(
                  (c) => c.instanceId === "host-" + remaining
                )?.zone
              ).toBe("field");
              expect(
                state.cardInstances.find(
                  (c) => c.instanceId === "brave-" + remaining
                )?.attachedToInstanceId
              ).toBe("host-" + remaining);
            }
            const action = getLegalActions({
              state,
              actingPlayerId: "alice",
              getCardDefinitionById,
            }).find(
              (a) =>
                a.kind === "resolve_brave_leave_choice" && a.choice === choice
            )!;
            expect(action).toBeDefined();
            state = applyLegalAction({
              state,
              action,
              getCardDefinitionById,
              getRegisteredTriggeredEffectActions: () => [],
              getRegisteredBurstActions: () => [],
              separateCoreDistribution:
                choice === "keep" ? { reserve: 1 } : undefined,
            }).state;
          }
          expect(state.pendingBraveLeaveChoice).toBeNull();
          expect(state.pendingLeaveEntities).toEqual([]);
          for (const i of ids) {
            expect(
              state.cardInstances.find((c) => c.instanceId === "host-" + i)
                ?.zone
            ).toBe("trash");
            expect(
              state.cardInstances.find((c) => c.instanceId === "brave-" + i)
            ).toMatchObject({
              zone: choice === "keep" ? "field" : "trash",
              normalCoreCount: choice === "keep" ? 1 : 0,
              attachedToInstanceId: null,
            });
          }
        });
      }

  it("EDH-0189: battle-end 後の最後の同行選択が attack-step end を stranded にしない", () => {
    const host = createCardInstance(hostDef, {
      instanceId: "host-edh-0189",
      ownerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 2,
      attachedChildrenIds: ["brave-edh-0189"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-edh-0189",
      ownerPlayerId: "alice",
      zone: "field",
      attachedToInstanceId: host.instanceId,
    });
    const attackId = "attack:edh-0189";
    let pendingChoiceState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave],
    });
    pendingChoiceState = flushPendingLeaves(
      queuePendingLeave({
        state: pendingChoiceState,
        instanceId: host.instanceId,
        kind: "destroy",
        cause: "effect_resolution",
        chainId: "battle-resolution:edh-0189",
      }),
      getCardDefinitionById
    );
    expect(pendingChoiceState.pendingBraveLeaveChoice).toMatchObject({
      hostInstanceId: host.instanceId,
    });

    const state = {
      ...pendingChoiceState,
      turnNumber: 29,
      activePlayerId: "alice",
      step: "attack" as const,
      window: "none" as const,
      pendingImmediateBattleEnds: [
        {
          attackId,
          participantInstanceIds: [host.instanceId, brave.instanceId],
          blockSideInstanceIds: [],
          participantSnapshots: [
            {
              entityId: "battle-entity:edh-0189",
              memberInstanceIds: [host.instanceId, brave.instanceId],
              resolvedBp: 3000,
              resolvedSymbols: ["red"],
              blockedBy: [],
            },
          ],
          appliedLifeDamage: 1,
          participantOwnSymbols: [
            { entityId: "battle-entity:edh-0189", ownSymbols: 1 },
          ],
        },
      ],
      pendingAttackStepEndFinalizations: [
        {
          pendingId: "attack-step-end:29:0",
          actingPlayerId: "alice",
          sourceInstanceId: "alice",
          createdAtTurn: 29,
        },
      ],
    };
    const sendWithHost = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById,
    }).find(
      (action) =>
        action.kind === "resolve_brave_leave_choice" &&
        action.choice === "send_with_host"
    );
    expect(sendWithHost).toBeDefined();

    const resolved = applyLegalAction({
      state,
      action: sendWithHost!,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: () => [],
    }).state;

    expect(resolved.pendingBraveLeaveChoice).toBeNull();
    expect(resolved.pendingLeaveEntities).toEqual([]);
    expect(resolved.pendingImmediateBattleEnds).toEqual([]);
    expect(resolved.pendingAttackStepEndFinalizations).toEqual([]);
    expect(resolved.step).toBe("end");
  });
});
