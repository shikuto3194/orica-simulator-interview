import { describe, it, expect } from "vitest";
import {
  applyLegalAction,
  getLegalActions,
  createEmptyGameState,
  createCardInstance,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type {
  CardDefinition,
  Effect,
  LegalAction,
  ApplyLegalActionOptions,
} from "../src";

function card(cardNo: string, effects: Effect[] = []): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
    symbolColors: ["red"],
    keywordTags: [],
    textLines: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}
describe("配置中止でも確定済み前段の派生と効果完了を失わない", () => {
  it.each(
    (["core", "multi", "legacy-below-min"] as const).flatMap((kind) =>
      (["increase_hand", "after_draw"] as const).map((event) => ({
        kind,
        event,
      }))
    )
  )(
    "$kind/$event: 前段ドローの派生と効果発揮後を各1回解決",
    ({ kind, event }) => {
      const source = card("ROLLBACK-SOURCE", [
        {
          timing: { kind: "card_event", event: "summon" },
          steps: [
            { action: { kind: "draw", count: 1 } },
            {
              action:
                kind === "multi"
                  ? {
                      kind: "summon",
                      target: {
                        kind: "from_zone",
                        zone: "hand",
                        filter: { cardName: { exact: "ROLLBACK-PICK" } },
                        count: 1,
                      },
                      costModifier: "free",
                    }
                  : {
                      kind: "core_distribute",
                      from: { kind: "reserve", player: "self" },
                      to: {
                        kind: "filter",
                        player: "self",
                        filter: { cardName: { exact: "ROLLBACK-SOURCE" } },
                        count: "all",
                      },
                      amount: "all",
                      mode: "player_choice",
                      minTotal: 1,
                    },
            },
          ],
        },
      ]);
      const drawWatch = card("ROLLBACK-DRAW-WATCH", [
        {
          timing: {
            kind: "game_event",
            event,
            player: "self",
          },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 10 } },
          ],
        },
      ]);
      const finishWatch = card("ROLLBACK-FINISH-WATCH", [
        {
          timing: {
            kind: "game_event",
            event: "effect_completed",
            player: "self",
            exactEventKind: true,
            triggerFilter: { cardName: { exact: source.name } },
          },
          steps: [
            { action: { kind: "count_increase", player: "self", amount: 1 } },
          ],
        },
      ]);
      const pick = card("ROLLBACK-PICK");
      const filler = card("ROLLBACK-FILLER");
      const defs = [source, drawWatch, finishWatch, pick, filler];
      const lookups = {
        getCardDefinitionById: (id: string) =>
          defs.find((d) => d.cardNo === id),
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(defs),
        getRegisteredBurstActions: () => [],
        getRegisteredFieldCardEffectActions: () => [],
        getRegisteredMagicActions: () => [],
      };
      let state = createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { handCount: 1, deckCount: 2, reserveNormalCoreCount: 5 },
          {},
        ],
        cardInstances: [
          ...[source, drawWatch, finishWatch].map((def) =>
            createCardInstance(def, {
              instanceId: def.cardNo,
              ownerPlayerId: "alice",
              zone: "field",
              normalCoreCount: 1,
            })
          ),
          createCardInstance(pick, {
            instanceId: "pick",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          ...["deck1", "deck2"].map((instanceId) =>
            createCardInstance(filler, {
              instanceId,
              ownerPlayerId: "alice",
              zone: "deck",
            })
          ),
        ],
      });
      state = queuePendingReactionsFromTriggerEvents(
        { ...state, step: "main", turnNumber: 3 },
        [
          {
            actingPlayerId: "alice",
            eventKind: "summon",
            source: "action_resolution",
            chainId: "outer-summon",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: source.cardNo,
            amount: null,
          },
        ],
        undefined,
        lookups
      );
      const act = (
        predicate: (a: LegalAction) => boolean,
        input: Partial<ApplyLegalActionOptions> = {}
      ) => {
        const actions = ["alice", "bob"].flatMap((actingPlayerId) =>
          getLegalActions({ state, actingPlayerId, ...lookups })
        );
        const action = actions.find(predicate);
        expect(action, JSON.stringify(actions)).toBeDefined();
        state = applyLegalAction({
          state,
          action: action!,
          ...lookups,
          ...input,
        }).state;
      };
      act(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === source.cardNo,
        kind === "multi" ? { targetInstanceIds: ["pick"] } : {}
      );
      while (state.stackWindow) act((a) => a.kind === "pass_stack");
      expect(state.players[0]!.handCount).toBe(kind === "multi" ? 1 : 2);
      if (kind === "legacy-below-min") {
        // rebirthCompletionを持たずsnapshotへ戻す既存保存形式も、同じ中止出口を通る。
        state = {
          ...state,
          pendingCoreDistribution: {
            ...state.pendingCoreDistribution!,
            rollbackIfBelowMinTotal: {
              minTotal: 1,
              reason: "rebirth_minimum_core",
            },
          },
        };
      }
      act(
        (a) =>
          a.kind ===
          (kind === "multi"
            ? "abort_pending_multi_placement"
            : kind === "core"
              ? "abort_pending_core_distribution"
              : "resolve_pending_core_distribution"),
        kind === "legacy-below-min" ? { coreDistributionAllocations: {} } : {}
      );
      expect(state.players[0]!.handCount).toBe(2);
      expect(
        state.cardInstances.find((c) => c.instanceId === "pick")?.zone
      ).toBe("hand");
      expect(state.players[0]!.countValue).toBe(0);
      for (const watcher of [drawWatch, finishWatch]) {
        act(
          (a) =>
            a.kind === "resolve_pending_triggered_effect" &&
            a.sourceInstanceId === watcher.cardNo
        );
        while (state.stackWindow) act((a) => a.kind === "pass_stack");
      }
      expect(state.players[0]!.countValue).toBe(11);
      expect(state.pendingEffectCompletions).toHaveLength(0);
      expect(state.pendingTriggeredEffects).toHaveLength(0);
    }
  );
});
