import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  flushPendingLeaves,
  getLegalActions,
} from "../src";
import { executeEffect } from "../src/effect/effect-interpreter";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const getCardDefinitionById = (id: string) =>
  definitions.find((definition) => definition.cardNo === id);
const lookups = {
  getCardDefinitionById,
  getRegisteredTriggeredEffectActions: () => [],
  getRegisteredBurstActions: () => [],
};

describe("魂状態置換とブレイヴ残留禁止", () => {
  for (const withAdventSource of [false, true]) {
    for (const choice of ["keep", "decline"] as const) {
      it(`暴食之王で消滅した神薙ユウを${choice} / 煌臨元=${withAdventSource}`, () => {
        // 2026-11-15 report: CX01 + TX01(A), with R03 as a bullet-edit
        // under-card, survives BSTS01-R03 with the brave incorrectly attached.
        const host = createCardInstance(getCardDefinitionById("BSGE01-CX01")!, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
          attachedChildrenIds: ["brave"],
        });
        host.underCards = [
          {
            cardInstanceId: "bullet",
            role: "text_role",
            roleTag: "バレットエディット",
          },
          ...(withAdventSource
            ? [{ cardInstanceId: "under", role: "advent_source" as const }]
            : []),
        ];
        const brave = createCardInstance(
          getCardDefinitionById("BSGE01-TX01(A)")!,
          {
            instanceId: "brave",
            ownerPlayerId: "alice",
            zone: "field",
            attachedToInstanceId: host.instanceId,
          }
        );
        const bullet = createCardInstance(
          getCardDefinitionById("BSGE01-R03")!,
          {
            instanceId: "bullet",
            ownerPlayerId: "alice",
            zone: "field",
            zoneRoleName: "bullet-edit",
            attachedToInstanceId: host.instanceId,
          }
        );
        const under = createCardInstance(getCardDefinitionById("BSGE01-R02")!, {
          instanceId: "under",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: "advent-source",
        });
        const magic = createCardInstance(getCardDefinitionById("BSTS01-R03")!, {
          instanceId: "magic",
          ownerPlayerId: "bob",
          zone: "in_use",
        });
        const before = createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [{ contractCardNo: host.definitionId }, {}],
          cardInstances: [
            host,
            brave,
            bullet,
            magic,
            ...(withAdventSource ? [under] : []),
          ],
        });
        const afterEffect = executeEffect({
          state: before,
          sourceInstanceId: magic.instanceId,
          actingPlayerId: "bob",
          effect: getCardDefinitionById(magic.definitionId)!.effects![1]!,
          targetInstanceIds: [host.instanceId],
          getCardDefinitionById,
          chainId: "forced-brave-soul",
        });
        expect(afterEffect.pendingLeaveEntities).toContainEqual(
          expect.objectContaining({
            instanceId: "host",
            forceBraveSendWithHost: true,
          })
        );
        const pending = flushPendingLeaves(afterEffect, getCardDefinitionById);
        expect(pending.pendingBraveLeaveChoice).toBeNull();
        expect(pending.pendingSoulStateReplacement?.leavingCardInstanceId).toBe(
          withAdventSource ? "host" : undefined
        );
        const action = getLegalActions({
          state: pending,
          actingPlayerId: "alice",
          ...lookups,
        }).find(
          (candidate) =>
            candidate.kind === "resolve_soul_state_replacement" &&
            candidate.choice === choice
        );
        expect(action).toBeDefined();
        const after = applyLegalAction({
          state: pending,
          action: action!,
          ...lookups,
        }).state;
        expect(
          after.cardInstances.find((card) => card.instanceId === "host")
        ).toMatchObject({
          zone: choice === "keep" ? "field" : "trash",
          normalCoreCount: 0,
          attachedChildrenIds: [],
        });
        expect(after.players[0]!.soulStateInstanceIds).toEqual(
          choice === "keep" ? ["host"] : []
        );
        expect(
          after.cardInstances.find((card) => card.instanceId === "brave")
        ).toMatchObject({
          zone: "trash",
          attachedToInstanceId: null,
          normalCoreCount: 0,
        });
        expect(
          after.cardInstances.find((card) => card.instanceId === "bullet")?.zone
        ).toBe(choice === "keep" ? "field" : "trash");
        expect(after.pendingLeaveEntities).toEqual([]);
        expect(after.pendingSoulStateReplacement).toBeNull();
        expect(after.pendingBraveLeaveChoice).toBeNull();
        expect(after.players[0]!.reserveNormalCoreCount).toBe(
          before.players[0]!.reserveNormalCoreCount + 1
        );
      });
    }
  }
});
