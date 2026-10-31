import { describe, expect, it } from "vitest";
import { BSAZ02_CARDS } from "../../card-data/src/cards/BSAZ02";
import {
  applyLegalAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  getLegalActions,
  type CardDefinition,
  type GameState,
} from "../src";
import type { Effect } from "../src/dsl-types";
import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
} from "../src/effect/structured-effect-registrations";

describe("move_self の離場反応窓", () => {
  for (const origin of ["registered", "granted"] as const)
    for (const decline of [false, true])
      it(`${origin}: 残置を${decline ? "辞退" : "選択"}してから移動とコア返却を確定する`, () => {
        const stay: Effect = {
          timing: { kind: "card_event", event: "leave_field" },
          executionMode: "optional",
          steps: [
            { action: { kind: "stay_on_field", target: { kind: "self" } } },
          ],
        };
        const hostDef: CardDefinition = {
          ...BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C06")!,
          cardNo: "TEST-MOVE-SELF-HOST",
          effects: [
            {
              timing: { kind: "activated", mode: "main" },
              steps: [{ action: { kind: "move_self", destination: "trash" } }],
            },
            ...(origin === "registered" ? [stay] : []),
          ],
        };
        const driveDef = BSAZ02_CARDS.find((c) => c.cardNo === "BSAZ02-C10")!;
        const definitions = [hostDef, driveDef];
        const lookups = {
          getCardDefinitionById: (id: string) =>
            definitions.find((d) => d.cardNo === id),
          getRegisteredTriggeredEffectActions:
            buildTriggeredEffectLookup(definitions),
          getRegisteredFieldCardEffectActions:
            buildFieldCardEffectLookup(definitions),
        };
        const host = createCardInstance(hostDef, {
          instanceId: "host",
          ownerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        });
        host.underCards = [
          {
            cardInstanceId: "drive",
            role: "text_role",
            roleTag: "アルドノアドライブ",
          },
        ];
        const drive = createCardInstance(driveDef, {
          instanceId: "drive",
          ownerPlayerId: "alice",
          zone: "field",
          attachedToInstanceId: "host",
        });
        let state: GameState = {
          ...createEmptyGameState({
            playerIds: ["alice", "bob"],
            cardInstances: [host, drive],
          }),
          activePlayerId: "alice",
          step: "main",
          turnNumber: 3,
        };
        const initialReserve = state.players[0]!.reserveNormalCoreCount;
        if (origin === "granted") {
          state = executeEffect({
            state,
            chainId: "grant-stay",
            sourceInstanceId: "host",
            actingPlayerId: "alice",
            ...lookups,
            effect: {
              timing: { kind: "activated", mode: "main" },
              steps: [
                {
                  action: {
                    kind: "grant_effect",
                    target: { kind: "self" },
                    duration: { scope: "turn" },
                    grantedEffect: stay,
                  },
                },
              ],
            },
          });
        }
        const actions = (actingPlayerId: string) =>
          getLegalActions({ state, actingPlayerId, ...lookups });
        const passStack = () => {
          for (let i = 0; i < 20; i++) {
            const pass = state.stackWindow
              ? actions(state.stackWindow.priorityPlayerId).find(
                  (a) => a.kind === "pass_stack"
                )
              : ["alice", "bob"]
                  .flatMap(actions)
                  .find(
                    (a) =>
                      a.kind === "resolve_pending_burst_check" &&
                      !a.sourceInstanceId
                  );
            if (!pass) break;
            state = applyLegalAction({
              state,
              action: pass!,
              ...lookups,
            }).state;
          }
          expect(state.stackWindow).toBeNull();
          expect(state.pendingBurstChecks).toHaveLength(0);
        };
        const use = actions("alice").find(
          (a) => a.kind === "use_field_card_effect"
        );
        expect(use).toBeDefined();
        state = applyLegalAction({ state, action: use!, ...lookups }).state;
        passStack();
        const find = (id: string) =>
          state.cardInstances.find((c) => c.instanceId === id)!;
        expect(find("host").zone).toBe("field");
        expect(find("host").normalCoreCount).toBe(2);
        expect(find("host").pendingLeaveKind).toBe("bounce");
        expect(find("drive").attachedToInstanceId).toBe("host");
        expect(state.players[0]!.reserveNormalCoreCount).toBe(initialReserve);
        const reaction = actions("alice").find(
          (a) => a.kind === "resolve_pending_triggered_effect"
        );
        expect(reaction).toBeDefined();
        state = applyLegalAction({
          state,
          action: reaction!,
          skipOptionalEffect: decline,
          ...lookups,
        }).state;
        passStack();
        expect(find("host").zone).toBe(decline ? "trash" : "field");
        expect(find("host").normalCoreCount).toBe(decline ? 0 : 2);
        expect(find("drive").zone).toBe(decline ? "trash" : "field");
        expect(find("drive").attachedToInstanceId).toBe(
          decline ? null : "host"
        );
        expect(state.players[0]!.reserveNormalCoreCount).toBe(
          initialReserve + (decline ? 2 : 0)
        );
        expect(state.pendingLeaveEntities).toHaveLength(0);
        expect(state.pendingTriggeredEffects).toHaveLength(0);
      });
});
