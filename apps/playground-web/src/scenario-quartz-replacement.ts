import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildQuartzReplacement(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  if (params?.get("mode") === "burst")
    return buildQuartzBurstReplacement(allCards, params);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const burstChoice = params?.get("effect") === "2";
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const get = (id: string) => allCards.find((c) => c.cardNo === id)!;
  const make = (
    no: string,
    id: string,
    zone: "field" | "hand" | "deck" | "in_use",
    quartz = false
  ) => ({
    ...createCardInstance(get(no), {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
    }),
    ...(quartz ? { zoneRoleName: "quartz" } : {}),
  });
  const state: GameState = {
    ...base,
    step: "main",
    activePlayerId: owner,
    turnNumber: 3,
    cardInstances: [
      make("BSLH01-CX01", "qr-host", "field"),
      make(
        params?.get("locked") === "1" ? "BSLH01-M03" : "BSLH01-C01",
        "qr-old",
        "field",
        true
      ),
      make(
        burstChoice ? "BSLH01-M03" : "BSLH01-C04",
        "qr-new",
        burstChoice ? "in_use" : "hand"
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        make("BSLH01-C01", `qr-deck-${i}`, "deck")
      ),
    ],
    quartzSetStates: [
      {
        quartzInstanceId: "qr-old",
        hostInstanceId: "qr-host",
        ownerPlayerId: owner,
        slot: "center",
      },
    ],
    players: base.players.map((p) => ({
      ...p,
      life: 5,
      reserve: 6,
      deckCount: p.id === owner ? 5 : 1,
      ...(p.id === owner
        ? {
            countValue: 10,
            handCount: burstChoice ? 0 : 1,
            soulStateInstanceIds: ["qr-host", "qr-old"],
          }
        : {}),
    })),
  };
  if (params?.get("effect") !== "1" && !burstChoice) return state;
  return executeEffect({
    state,
    sourceInstanceId: "qr-new",
    actingPlayerId: owner,
    effectIndex: 0,
    effect: burstChoice
      ? get("BSLH01-M03").effects![0]!
      : {
          timing: { kind: "activated", mode: "main" },
          steps: [
            { action: { kind: "quartz_set", target: { kind: "source_card" } } },
          ],
        },
    getCardDefinitionById: get,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    chainId: "quartz-effect-placement",
    promptUnresolvedChoice: true,
  });
}

/** Telegram 629905086相当。効果を直接実行せず、実際のバースト宣言から開始する。 */
function buildQuartzBurstReplacement(
  allCards: CardDefinition[],
  params: URLSearchParams
): GameState {
  const owner = params.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const get = (id: string) => allCards.find((c) => c.cardNo === id)!;
  const make = (
    no: string,
    id: string,
    zone: "field" | "burst" | "deck",
    playerId = owner
  ) =>
    createCardInstance(get(no), {
      instanceId: id,
      ownerPlayerId: playerId,
      zone,
      ...(playerId === opponent ? { normalCoreCount: 1 } : {}),
    });
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return {
    ...base,
    turnNumber: 3,
    activePlayerId: opponent,
    step: "main",
    players: base.players.map((p) => ({
      ...p,
      handCount: 0,
      deckCount: p.id === owner ? 5 : 1,
      ...(p.id === owner
        ? { countValue: 0, soulStateInstanceIds: ["qr-host", "qr-old"] }
        : {}),
    })),
    cardInstances: [
      make("BSLH01-CX01", "qr-host", "field"),
      { ...make("BSLH01-C06", "qr-old", "field"), zoneRoleName: "quartz" },
      make("BSLH01-R05", "qr-new", "burst"),
      make("BSTH01-C02", "qr-target-a", "field", opponent),
      make("BSTH01-C02", "qr-target-b", "field", opponent),
      ...Array.from({ length: 5 }, (_, i) =>
        make("BSTH01-C02", `qr-deck-${i}`, "deck")
      ),
    ],
    quartzSetStates: [
      {
        quartzInstanceId: "qr-old",
        hostInstanceId: "qr-host",
        ownerPlayerId: owner,
        slot: "right",
      },
    ],
    setBurstStates: [{ playerId: owner, cardInstanceId: "qr-new" }],
    pendingBurstChecks: [
      {
        checkId: "qr-burst",
        actingPlayerId: owner,
        eventKind: "effect_activated",
        event: {
          family: "effect_activation",
          actionKind: "summon",
          validationMode: "snapshot_only",
        },
        source: "action_resolution",
        chainId: "scenario:quartz-burst",
        attackId: null,
        relatedPlayerId: opponent,
        relatedInstanceId: "qr-target-a",
        amount: 1,
        step: "main",
        window: "none",
        resolvedBurstCardInstanceIds: [],
      },
    ],
  };
}
