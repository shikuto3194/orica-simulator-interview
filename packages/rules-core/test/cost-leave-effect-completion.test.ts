import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildTriggeredEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  rebuildContinuousEffectsFromField,
  type GameState,
  type CardDefinition,
} from "../src";

const definitions = new Map(ALL_CARDS.map((card) => [card.cardNo, card]));
const lookups = {
  getCardDefinitionById: (id: string) => definitions.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredMagicActions: buildMagicLookup(ALL_CARDS),
  getRegisteredHandCardEffectActions: () => undefined,
  getRegisteredBurstActions: () => [],
  getRegisteredBattleImmediateEffectActions: () => [],
};

function setup(owner: string, watch?: "effect_completed" | "leave_field") {
  const watcher: CardDefinition = {
    ...definitions.get("BSTH04-転醒R01(A)")!,
    cardNo: "COMPLETION-WATCHER",
    name: "COMPLETION-WATCHER",
    effects: [
      {
        timing: {
          kind: "game_event",
          event: watch ?? "effect_completed",
          player: "self",
          exactEventKind: true,
          triggerFilter: {
            cardName: {
              exact: definitions.get(
                watch === "leave_field" ? "BSTH04-C01" : "BSTH04-転醒R01(A)"
              )!.name,
            },
          },
        },
        steps: [
          { action: { kind: "count_increase", player: "self", amount: 1 } },
        ],
      },
    ],
  };
  const localLookups = {
    ...lookups,
    getCardDefinitionById: (id: string) =>
      id === watcher.cardNo ? watcher : definitions.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(
      watch ? [...ALL_CARDS, watcher] : ALL_CARDS
    ),
  };
  let state: GameState = rebuildContinuousEffectsFromField(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 0 },
          { reserveNormalCoreCount: 0 },
        ],
        cardInstances: [
          ...(
            [
              ["payer", "BSTH04-C01", "field", 2],
              ["mirror", "BSTH04-転醒R01(A)", "hand", 0],
              ["pick", "BSTH04-M01", "deck", 0],
              ["other", "BSTH04-X03", "deck", 0],
            ] as const
          ).map(([instanceId, no, zone, cores]) =>
            createCardInstance(definitions.get(no)!, {
              instanceId,
              ownerPlayerId: owner,
              zone,
              normalCoreCount: cores,
            })
          ),
          ...(watch
            ? [
                createCardInstance(watcher, {
                  instanceId: "watcher",
                  ownerPlayerId: owner,
                  zone: "field",
                }),
              ]
            : []),
        ],
      }),
      activePlayerId: owner,
      step: "main",
      turnNumber: 2,
    },
    localLookups.getCardDefinitionById
  );
  const apply = (
    kind: string,
    payload: Partial<Parameters<typeof applyLegalAction>[0]> = {},
    choice?: string
  ) => {
    const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
      getLegalActions({ state, actingPlayerId, ...localLookups })
    );
    const action = actions.find(
      (a) =>
        a.kind === kind &&
        a.can &&
        (choice === undefined || ("choice" in a && a.choice === choice))
    );
    expect(
      action,
      JSON.stringify({ kind, actions, log: state.log.slice(-8) })
    ).toBeDefined();
    state = applyLegalAction({
      state,
      action: action!,
      ...localLookups,
      ...payload,
    }).state;
  };
  const zone = (id: string) =>
    state.cardInstances.find((card) => card.instanceId === id)?.zone;
  return { apply, zone, state: () => state };
}

describe("コスト消滅は効果完了通知まで待ち、通知を消化した同じ操作で離脱する", () => {
  it.each(["effect_completed", "leave_field"] as const)(
    "同類監査: %s の派生を一度だけ解決する",
    (watch) => {
      const s = setup("alice", watch);
      s.apply("place_nexus", {
        paymentSources: [{ kind: "card", instanceId: "payer", amount: 2 }],
      });
      s.apply("pass_stack");
      s.apply("resolve_pending_triggered_effect");
      s.apply("pass_stack");
      s.apply("resolve_pending_step_optional_choice", {}, "execute");
      s.apply("resolve_pending_step_optional_target_selection", {
        targetInstanceIds: ["pick"],
      });
      // 発揮後の派生はコスト消滅より先、実移動の派生はコスト消滅より後。
      expect(s.zone("payer")).toBe(
        watch === "effect_completed" ? "field" : "trash"
      );
      expect(s.state().pendingTriggeredEffects).toHaveLength(1);
      expect(s.state().pendingTriggeredEffects[0]?.eventKind).toBe(watch);
      s.apply("resolve_pending_triggered_effect");
      s.apply("pass_stack");
      expect(s.zone("payer")).toBe("trash");
      expect(s.state().players[0]?.countValue).toBe(1);
      expect(s.state().pendingTriggeredEffects).toHaveLength(0);
      expect(s.state().pendingEffectCompletions).toHaveLength(0);
      expect(s.state().pendingLeaveEntities).toHaveLength(0);
    }
  );
  for (const owner of ["alice", "bob"]) {
    it.each(["take", "decline-recovery", "decline-effect"])(
      `BSTH04-C01 / 浄玻璃の鏡 ${owner}: %s`,
      (mode) => {
        const s = setup(owner);
        s.apply("place_nexus", {
          paymentSources: [{ kind: "card", instanceId: "payer", amount: 2 }],
        });
        expect(s.zone("payer")).toBe("field");
        expect(s.state().pendingLeaveEntities[0]?.cause).toBe("cost_payment");
        s.apply("pass_stack");
        expect(s.zone("payer")).toBe("field");
        s.apply("resolve_pending_triggered_effect", {
          skipOptionalEffect: mode === "decline-effect",
        });
        if (mode !== "decline-effect") {
          s.apply("pass_stack");
          expect(s.zone("payer")).toBe("field");
          expect(s.zone("pick")).toBe("trash");
          s.apply(
            "resolve_pending_step_optional_choice",
            {},
            mode === "take" ? "execute" : "decline"
          );
          if (mode === "take") {
            expect(s.zone("payer")).toBe("field");
            s.apply("resolve_pending_step_optional_target_selection", {
              targetInstanceIds: ["pick"],
            });
          }
        }
        expect(s.state().pendingEffectCompletions).toHaveLength(0);
        expect(s.state().pendingTriggeredEffects).toHaveLength(0);
        expect(s.state().effectQueueEntries).toHaveLength(0);
        expect(s.zone("payer")).toBe("trash");
        expect(s.state().pendingLeaveEntities).toHaveLength(0);
        expect(s.zone("pick")).toBe(
          mode === "take"
            ? "hand"
            : mode === "decline-effect"
              ? "deck"
              : "trash"
        );
      }
    );
  }
});
