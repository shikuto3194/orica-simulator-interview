import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
import { executeRefSummon } from "../../../packages/rules-core/src/effect/structured-summon";

/** 魔法使い達の杖を効果召喚し、導界者・魅魔との合体を選ぶ盤面。 */
function buildGuidedBraveChoiceScenario(
  cards: CardDefinition[],
  owner: string
): GameState {
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ id: owner, reserveNormalCoreCount: 4 }],
      cardInstances: [
        createCardInstance(lookup("BSTH003-X01")!, {
          instanceId: "brave-host",
          ownerPlayerId: owner,
          zone: "field",
          cores: 2,
        }),
        createCardInstance(lookup("BSTH003-C31")!, {
          instanceId: "brave-deck-0",
          ownerPlayerId: owner,
          zone: "hand",
        }),
      ],
    }),
    activePlayerId: owner,
    step: "main",
  };
  return executeRefSummon(
    state,
    owner,
    {
      kind: "summon",
      target: { kind: "ref", stepId: "selected" },
      costModifier: "free",
    },
    lookup,
    ["brave-deck-0"],
    "brave-host"
  );
}

/** メタナイトの公開から宝剣ギャラクシアを召喚する、実カードの選択前盤面。 */
export function buildEffectBraveChoiceScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  if (params?.get("host") === "guided") {
    return buildGuidedBraveChoiceScenario(cards, owner);
  }
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const source = lookup("BSKB01-M01")!;
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        reserveNormalCoreCount: 4,
        deckCount: id === owner ? 3 : 0,
      })),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "brave-host",
          ownerPlayerId: owner,
          zone: "field",
          cores: 1,
        }),
        ...["BSKB01-R03", "BSTH01-C01", "BSTH01-C01"].map((no, i) =>
          createCardInstance(lookup(no)!, {
            instanceId: `brave-deck-${i}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
    }),
    activePlayerId: owner,
    step: "attack",
  };
  return executeEffect({
    state,
    chainId: "scenario:effect-brave-choice",
    effect: source.effects![0]!,
    sourceInstanceId: "brave-host",
    actingPlayerId: owner,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  });
}
