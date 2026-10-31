import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
  type Effect,
  type EffectStep,
} from "@orica/rules-core";
import { buildDivineSkillPaymentScenario } from "./scenario-divine-skill-payment";

/** キーア導技2の実データを、オープン後の選択待ちまで実行する。 */
export function buildRevealedTargetSelectionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const getDefinition = (id: string) => definitions.get(id);
  const mode = params?.get("mode") ?? "keya";
  if (mode === "borrow-hand") {
    const borrowSource = getDefinition("BSRK01-M01")!;
    const instances = [
      createCardInstance(borrowSource, {
        instanceId: "borrow-source",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 1,
      }),
      createCardInstance(getDefinition("BSRK01-C01")!, {
        instanceId: "borrow-donor",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      createCardInstance(getDefinition("BSRK01-CX01")!, {
        instanceId: "borrow-contract",
        ownerPlayerId: owner,
        zone: "hand",
      }),
      createCardInstance(getDefinition("BSTH11-X03")!, {
        instanceId: "borrow-private-hand",
        ownerPlayerId: owner,
        zone: "hand",
      }),
    ];
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: instances,
    });
    return executeEffect({
      state: { ...base, step: "main", turnNumber: 3, activePlayerId: owner },
      chainId: "scenario:borrow-hand-disclosure",
      effect: borrowSource.effects![0]!,
      effectIndex: 0,
      sourceInstanceId: "borrow-source",
      actingPlayerId: owner,
      targetInstanceIds: ["borrow-donor"],
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: () => [],
    });
  }
  const source = getDefinition(
    mode === "chen"
      ? "BSTH02-C03"
      : mode === "rinnosuke"
        ? "BSTH01-M03"
        : "BSLH01-X01"
  )!;
  const host = getDefinition("BSLH01-CX01")!;
  const quartz = cards.filter(
    (card) => card.cardNo.startsWith("BSLH01-") && card.quartzData
  );
  const count = Number(params?.get("candidates") ?? 2);
  const filler = getDefinition("BSTH01-C01")!;
  const deckDefinitions =
    mode === "chen"
      ? [
          ...cards
            .filter(
              (card) =>
                card.printedCategory === "spirit" &&
                card.tribe?.includes("妖戒")
            )
            .slice(0, 3),
          filler,
        ]
      : mode === "rinnosuke"
        ? [
            getDefinition("BSLH01-X01")!,
            getDefinition("BSTH01-C01")!,
            getDefinition("BSTH01-C02")!,
            filler,
            filler,
          ]
        : [0, 1].map((index) => (index < count ? quartz[index]! : filler));
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const state: GameState = {
    ...base,
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    players: base.players.map((player) => ({
      ...player,
      reserveNormalCoreCount: 20,
      deckCount: player.id === owner ? deckDefinitions.length : 0,
      handCount: 1,
      ...(player.id === owner ? { soulStateInstanceIds: ["reveal-host"] } : {}),
    })),
    cardInstances: [
      createCardInstance(source, {
        instanceId: "reveal-source",
        ownerPlayerId: owner,
        zone: "field",
        normalCoreCount: 2,
      }),
      createCardInstance(host, {
        instanceId: "reveal-host",
        ownerPlayerId: owner,
        zone: "field",
      }),
      ...deckDefinitions.map((definition, index) =>
        createCardInstance(definition, {
          instanceId: `reveal-card-${index}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
      ...["alice", "bob"].map((playerId, index) =>
        createCardInstance(
          getDefinition(index === 0 ? "BSTH11-X03" : "BSTH11-X04")!,
          {
            instanceId: `${playerId}-private-hand`,
            ownerPlayerId: playerId,
            zone: "hand",
          }
        )
      ),
    ],
  };
  if (params?.get("declare") === "1") {
    const flash = buildDivineSkillPaymentScenario(
      cards,
      new URLSearchParams({ owner, card: "BSLH01-X01" })
    );
    return {
      ...state,
      step: flash.step,
      window: flash.window,
      activePlayerId: flash.activePlayerId,
      activeAttack: flash.activeAttack,
      battleEntities: flash.battleEntities,
      cardInstances: [
        ...state.cardInstances,
        ...flash.cardInstances.filter(
          (card) => card.instanceId === "divine-attacker"
        ),
      ],
    };
  }
  let effect: Effect =
    mode === "chen"
      ? source.effects![0]!
      : mode === "rinnosuke"
        ? source.effects![1]!
        : source.grandwalkerData!.divineSkills![0]!.effects![0]!;
  if (mode === "mixed" || mode === "sequence") {
    const zones =
      mode === "mixed"
        ? (["revealed", "trash"] as const)
        : (["revealed"] as const);
    if (mode === "mixed")
      state.cardInstances.push(
        createCardInstance(filler, {
          instanceId: "reveal-trash",
          ownerPlayerId: owner,
          zone: "trash",
        })
      );
    const move: EffectStep = {
      targetSelectionTiming: "on_step",
      action: {
        kind: "move_card",
        target: {
          kind: "filter",
          player: "self",
          zone: [...zones],
          filter: {},
          count: 1,
        },
        from: { zone: [...zones], player: "self" },
        to: { zone: "hand" },
        count: "all",
      },
    };
    const reveal = effect.steps[0]!.action;
    if (reveal.kind !== "deck_reveal")
      throw new Error("expected reveal fixture");
    effect = {
      ...effect,
      steps: [
        {
          ...effect.steps[0]!,
          action: {
            ...reveal,
            beforePickSteps: [
              { ...move, id: "first" },
              { ...move, id: "second" },
            ],
          },
        },
      ],
    };
  }
  return executeEffect({
    state,
    chainId: "scenario:revealed-target-selection",
    effect,
    effectIndex: mode === "rinnosuke" ? 1 : 0,
    ...(!["chen", "rinnosuke"].includes(mode) ? { divineSkillIndex: 0 } : {}),
    promptUnresolvedChoice: true,
    sourceInstanceId: "reveal-source",
    actingPlayerId: owner,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
