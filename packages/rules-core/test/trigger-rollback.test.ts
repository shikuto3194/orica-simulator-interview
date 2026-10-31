import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  getLegalActions,
  createEmptyGameState,
  createCardInstance,
  buildTriggeredEffectLookup,
  expandCardDefinitionsWithBackFaces,
  queuePendingReactionsFromTriggerEvents,
} from "../src";
import type { GameState, LegalAction, ApplyLegalActionOptions } from "../src";

const definitions = expandCardDefinitionsWithBackFaces(ALL_CARDS);
const lookup = new Map(definitions.map((d) => [d.cardNo, d]));
const lookups = {
  getCardDefinitionById: (id: string) => lookup.get(id),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(definitions),
  getRegisteredBurstActions: () => [],
  getRegisteredFieldCardEffectActions: () => [],
  getRegisteredMagicActions: () => [],
};
function actions(state: GameState) {
  return ["alice", "bob"].flatMap((actingPlayerId) =>
    getLegalActions({ state, actingPlayerId, ...lookups })
  );
}
function act(
  state: GameState,
  predicate: (a: LegalAction) => boolean,
  input: Partial<ApplyLegalActionOptions> = {}
) {
  const action = actions(state).find(predicate);
  expect(action, JSON.stringify(actions(state))).toBeDefined();
  return applyLegalAction({ state, action: action!, ...lookups, ...input })
    .state;
}
function resolve(
  state: GameState,
  source: string,
  registrationIndex?: number,
  input: Partial<ApplyLegalActionOptions> = {}
) {
  state = act(
    state,
    (a) =>
      a.kind === "resolve_pending_triggered_effect" &&
      a.sourceInstanceId === source &&
      (registrationIndex === undefined ||
        a.registrationIndex === registrationIndex),
    input
  );
  for (let i = 0; state.stackWindow && i < 8; i++)
    state = act(state, (a) => a.kind === "pass_stack");
  expect(state.stackWindow).toBeNull();
  return state;
}
function setup(owner: string, host = "BSSA01-C03", cores = 1): GameState {
  const card = (
    no: string,
    id: string,
    zone: "field" | "hand" | "deck",
    cores = 0
  ) =>
    createCardInstance(lookup.get(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      card(host, "host", "field", cores),
      card("BSSA01-転醒X01(A)", "x01", "field"),
      card("BSSA01-転醒X01(A)", "other-x01", "field"),
      card("BSSA01-転醒X04(A)", "x04", "field"),
      card("BSSA01-X01", "combine-host", "field", 1),
      card("BSSA01-C01", "deck1", "deck"),
      card("BSSA01-C01", "deck2", "deck"),
    ],
    playerOverrides: ["alice", "bob"].map((id) =>
      id === owner
        ? {
            reserveNormalCoreCount: 5,
            trashNormalCoreCount: 2,
            countValue: 2,
            deckCount: 2,
            handCount: 0,
          }
        : {}
    ),
  });
  return queuePendingReactionsFromTriggerEvents(
    { ...state, step: "main", turnNumber: 3, activePlayerId: owner },
    [
      {
        actingPlayerId: owner,
        eventKind: "summon",
        source: "action_resolution",
        chainId: "original-summon",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "host",
        amount: null,
      },
    ],
    "original-summon",
    lookups
  );
}

describe("選択中止の盤面巻き戻しと誘発の保持", () => {
  for (const owner of ["alice", "bob"])
    for (const saved of [false, true]) {
      it.each(["abort", "below-minimum", "core", "combine"] as const)(
        `${owner} JSON=${saved}: %s後に元のキリト召喚時を1回だけ解決`,
        (route) => {
          let state = resolve(setup(owner), "x01");
          if (route === "combine") {
            if (saved) state = JSON.parse(JSON.stringify(state));
            state = act(
              state,
              (a) =>
                a.kind === "resolve_brave_combine_choice" &&
                a.chosenHostInstanceId === "combine-host"
            );
          } else {
            state = act(
              state,
              (a) =>
                a.kind === "resolve_brave_combine_choice" &&
                a.chosenHostInstanceId === null
            );
            if (saved) state = JSON.parse(JSON.stringify(state));
            state =
              route === "abort"
                ? act(
                    state,
                    (a) => a.kind === "abort_pending_core_distribution"
                  )
                : act(
                    state,
                    (a) => a.kind === "resolve_pending_core_distribution",
                    {
                      coreDistributionAllocations:
                        route === "core" ? { x01: 1 } : {},
                      coreDistributionSourceAllocations:
                        route === "core" ? { reserve: 1 } : {},
                    }
                  );
          }
          const succeeded = route === "core" || route === "combine";
          expect(
            state.cardInstances.find((c) => c.instanceId === "x01")
              ?.definitionId
          ).toBe(`BSSA01-転醒X01(${succeeded ? "B" : "A"})`);
          expect(state.players.find((p) => p.id === owner)?.countValue).toBe(
            succeeded ? 3 : 2
          );
          const sources = actions(state).filter(
            (a) => a.kind === "resolve_pending_triggered_effect"
          );
          expect(sources.some((a) => a.sourceInstanceId === "host")).toBe(true);
          expect(sources.some((a) => a.sourceInstanceId === "x01")).toBe(false);
          expect(sources.some((a) => a.sourceInstanceId === "other-x01")).toBe(
            !succeeded
          );
          state = resolve(state, "host");
          // C03 now keeps the optional discard cost separate from the basic
          // draw. Choose zero discards, then explicitly take that basic draw.
          state = act(
            state,
            (a) =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.choice === "decline"
          );
          state = act(
            state,
            (a) =>
              a.kind === "resolve_pending_step_optional_choice" &&
              a.choice === "execute"
          );
          expect(state.players.find((p) => p.id === owner)?.handCount).toBe(1);
          expect(state.players.find((p) => p.id === owner)?.deckCount).toBe(1);
          expect(
            actions(state).some(
              (a) =>
                a.kind === "resolve_pending_triggered_effect" &&
                a.sourceInstanceId === "host"
            )
          ).toBe(false);
        }
      );
    }

  it.each([1, 2])(
    "アリスLv%d: 転醒合体後も回復効果の必要レベルを維持",
    (cores) => {
      let state = resolve(setup("alice", "BSSA01-X02", cores), "x04");
      state = act(
        state,
        (a) =>
          a.kind === "resolve_brave_combine_choice" &&
          a.chosenHostInstanceId === "host"
      );
      const heal = actions(state).filter(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "host" &&
          a.registrationIndex === 1
      );
      expect(heal).toHaveLength(cores === 2 ? 1 : 0);
      if (cores === 2) {
        state = resolve(state, "host", 1);
        expect(state.players[0]!.lifeNormalCoreCount).toBe(6);
        expect(state.players[0]!.trashNormalCoreCount).toBe(1);
      }
    }
  );

  it.each(["alice", "bob"])(
    "%s: 複数召喚配置の中止後も同じカードの別の召喚時は残り、召喚は巻き戻る",
    (owner) => {
      let state = setup(owner, "BSSA01-X02", 2);
      state = {
        ...state,
        cardInstances: [
          ...state.cardInstances,
          createCardInstance(lookup.get("BSSA01-C02")!, {
            instanceId: "summoned",
            ownerPlayerId: owner,
            zone: "hand",
          }),
        ],
        players: state.players.map((p) =>
          p.id === owner ? { ...p, handCount: 1 } : p
        ),
      };
      state = resolve(state, "host", 0, { targetInstanceIds: ["summoned"] });
      expect(state.pendingMultiPlacement).not.toBeNull();
      state = act(
        JSON.parse(JSON.stringify(state)),
        (a) => a.kind === "abort_pending_multi_placement"
      );
      expect(
        state.cardInstances.find((c) => c.instanceId === "summoned")?.zone
      ).toBe("hand");
      expect(
        state.pendingTriggeredEffects.some(
          (p) => p.relatedInstanceId === "summoned"
        )
      ).toBe(false);
      const remaining = actions(state).filter(
        (a) =>
          a.kind === "resolve_pending_triggered_effect" &&
          a.sourceInstanceId === "host"
      );
      expect(remaining.map((a) => a.registrationIndex)).toEqual([1]);
      state = resolve(state, "host", 1);
      expect(
        state.players.find((p) => p.id === owner)?.lifeNormalCoreCount
      ).toBe(6);
    }
  );
});
