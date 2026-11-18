import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyDraftCoreMoves,
  createCardInstance,
  createEmptyGameState,
  findManualCoreMoveViolation,
  type DraftCoreMove,
} from "../src";

const lookup = (id: string) => ALL_CARDS.find((card) => card.cardNo === id);

describe("カード状態への手動コア移動", () => {
  for (const mode of [
    "soul",
    "card",
    "face_down",
    "advent_source",
    "text_role",
    "spirit",
    "clone",
  ] as const) {
    it.each(["normal", "soul"] as const)(
      `${mode}: %s の配置可否とpreviewを共有する`,
      (kind) => {
        const target = createCardInstance(lookup("BSRK01-CX01")!, {
          instanceId: "target",
          ownerPlayerId: "alice",
          zone: "field",
          zoneRoleName: mode === "card" ? "spirit-card" : "spirit",
          normalCoreCount: mode === "spirit" || mode === "clone" ? 1 : 0,
          faceDown: mode === "face_down" || mode === "clone",
        });
        const host = createCardInstance(lookup("BSRK01-C04")!, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        });
        if (mode === "advent_source" || mode === "text_role") {
          host.underCards = [{ cardInstanceId: target.instanceId, role: mode }];
        }
        const state = createEmptyGameState({
          playerIds: ["alice", "bob"],
          cardInstances: [target, host],
          playerOverrides: [
            {
              reserveNormalCoreCount: 3,
              reserveSoulCoreCount: 1,
              soulStateInstanceIds: mode === "soul" ? [target.instanceId] : [],
            },
            {},
          ],
        });
        if (mode === "clone") {
          state.activeContinuousEffects.push({
            effectId: "clone-state",
            sourceInstanceId: host.instanceId,
            sourceDefinitionId: host.definitionId,
            actingPlayerId: "alice",
            targetInstanceId: target.instanceId,
            modifierTag: "act_as_spirit",
            duration: { scope: "while_on_field" },
            createdAtTurn: 1,
            createdAtAttackId: null,
          });
        }
        const draft: DraftCoreMove =
          kind === "normal"
            ? {
                kind,
                from: { kind: "reserve", playerId: "alice" },
                to: { kind: "card", instanceId: target.instanceId },
                amount: 1,
                purpose: "core_move",
              }
            : {
                kind,
                playerId: "alice",
                from: { kind: "reserve", playerId: "alice" },
                to: { kind: "card", instanceId: target.instanceId },
                purpose: "core_move",
              };
        const allowed = mode === "spirit" || mode === "clone";
        expect(
          findManualCoreMoveViolation(state, [draft], lookup)?.side ?? null
        ).toBe(allowed ? null : "to");
        const after = applyDraftCoreMoves(state, [draft], lookup);
        if (!allowed) {
          expect(after).toBe(state);
          expect(
            after.cardInstances.find(
              (card) => card.instanceId === target.instanceId
            )?.normalCoreCount
          ).toBe(0);
          expect(after.players[0]!.reserveNormalCoreCount).toBe(3);
          expect(after.players[0]!.reserveSoulCoreCount).toBe(1);
        } else {
          const placed = after.cardInstances.find(
            (card) => card.instanceId === target.instanceId
          )!;
          expect(
            kind === "normal" ? placed.normalCoreCount : placed.soulCoreCount
          ).toBe(kind === "normal" ? 2 : 1);
        }
      }
    );
  }
});
