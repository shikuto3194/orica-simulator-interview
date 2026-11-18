import {
  applyLegalAction,
  buildMagicLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  getLegalActions,
  type GameState,
  type LegalAction,
  type CardDefinition,
  recomputeAndRebuildContinuousEffects,
} from "@orica/rules-core";

/** ユージオの攻撃へ天翔龍閃を使用した直後。作戦のコストと応答解決順を確認する。 */
export function buildStackOperationScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const cards = expandCardDefinitionsWithBackFaces(allCards);
  const getCardDefinitionById = (id: string) =>
    cards.find((c) => c.cardNo === id);
  const make = (
    no: string,
    id: string,
    owner: string,
    zone: "field" | "hand",
    cores = 0
  ) =>
    createCardInstance(getCardDefinitionById(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const eugeo = make("BSSA01-転醒X03(A)", "eugeo", "alice", "field", 4);
  const rose = make("BSSA01-転醒X02(A)", "rose", "alice", "field");
  eugeo.attachedChildrenIds = ["rose"];
  rose.attachedToInstanceId = "eugeo";
  let state = recomputeAndRebuildContinuousEffects(
    {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { reserveNormalCoreCount: 20, countValue: 1 },
          { reserveNormalCoreCount: 20, countValue: 1 },
        ],
        cardInstances: [
          eugeo,
          rose,
          make("BSSA01-C01", "alice-spirit", "alice", "field", 1),
          make("BSAZ01-C08", "operation", "alice", "field"),
          make("BSRK01-CX01", "kenshin", "bob", "field", 1),
          make("BSSA01-C01", "bob-spirit", "bob", "field", 1),
          make("BSRK01-R01", "r01", "bob", "hand"),
          make("BSRK01-R02", "r02", "bob", "hand"),
        ],
      }),
      step: "attack",
      turnNumber: 7,
      activePlayerId: "alice",
    },
    getCardDefinitionById
  );
  if (params?.get("stage") === "initial") return state;
  const lookups = {
    getCardDefinitionById,
    getRegisteredMagicActions: buildMagicLookup(cards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(cards),
    getRegisteredBurstActions: buildBurstEffectLookup(cards),
  };
  const perform = (kind: LegalAction["kind"], sourceInstanceId?: string) => {
    const action = ["alice", "bob"]
      .flatMap((actingPlayerId) =>
        getLegalActions({ state, actingPlayerId, ...lookups })
      )
      .find(
        (a) =>
          a.kind === kind &&
          (!sourceInstanceId ||
            ("sourceInstanceId" in a &&
              a.sourceInstanceId === sourceInstanceId))
      );
    if (!action) throw new Error("Stack operation scenario: missing " + kind);
    state = applyLegalAction({
      state,
      action,
      ...lookups,
      ...(action.kind === "use_magic"
        ? {
            paymentSources: [
              { kind: "reserve" as const, amount: action.finalCost },
            ],
          }
        : {}),
    }).state;
  };
  perform("attack", "eugeo");
  perform("use_magic", "r02");
  return state;
}
