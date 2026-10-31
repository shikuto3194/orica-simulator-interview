import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type Effect,
  type GameState,
} from "@orica/rules-core";

/** Minimal board reconstructed from Telegram 629905088; attachment is reference data only. */
export function buildBraveSemanticEventsScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const mode = params?.get("mode") ?? "effect-combine";
  const lookup = (id: string) => cards.find((c) => c.cardNo === id);
  const make = (
    no: string,
    id: string,
    zone: "field" | "set_aside" | "hand",
    cores = 0
  ) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const host = make("BSTH08.5-X01", "card-14", "field", 2);
  host.exhaustState = "exhausted";
  const incoming = make(
    "BSTH08.5-C21",
    "card-3",
    mode === "effect-combine" ? "set_aside" : "hand"
  );
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount:
          id === owner && incoming.zone === "hand"
            ? mode === "direct-summon"
              ? 2
              : 1
            : 0,
        reserveNormalCoreCount: 15,
      })),
      cardInstances: [
        host,
        incoming,
        make("BSTH08.5-X03", "card-18", "field", 2),
        make(
          "BSTH08.5-C20",
          "card-5",
          mode === "direct-summon" ? "hand" : "set_aside"
        ),
        make("BSTH08.5-C21", "card-13", "set_aside"),
        make("BSTH08.5-C21", "card-15", "set_aside"),
        make("BSTH09-TR01(A)", "card-16", "field"),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 21,
    step: mode === "effect-combine" ? "attack" : "main",
    window: "none",
  };
  if (mode === "summon")
    return recomputeAndRebuildContinuousEffects(state, lookup);
  const effect: Effect =
    mode === "effect-combine"
      ? lookup("BSTH08.5-X01")!.effects![2]!
      : {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              id: "select-brave",
              targetSelectionTiming: "on_step",
              action: {
                kind: "noop",
                target: {
                  kind: "filter",
                  player: "self",
                  zone: "hand",
                  filter: { category: ["brave"] },
                  count: 1,
                },
              },
            },
            {
              action: {
                kind: "brave_combine_effect",
                source: { stepId: "select-brave" },
                target: { kind: "self" },
                asSummon: true,
              },
            },
          ],
        };
  return executeEffect({
    state,
    effect,
    effectIndex: mode === "effect-combine" ? 2 : 0,
    sourceInstanceId: host.instanceId,
    actingPlayerId: owner,
    chainId: `telegram-629905088:${mode}:${owner}`,
    firingBattleEndDeferral: mode === "effect-combine",
    promptUnresolvedChoice: true,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  });
}
