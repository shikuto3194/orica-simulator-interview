import type { CardDefinition, GameState } from "@orica/rules-core";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
  queueRegisteredBattleImmediateEffects,
  recordEffectUsage,
} from "@orica/rules-core";

/** 召喚効果をメインで使用済み。アタック時のライフ回復効果を実登録から宣言する。 */
export function buildBssa01EffectTextScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const def = cards.find((card) => card.cardNo === "BSSA01-X02")!;
  const source = createCardInstance(def, {
    instanceId: "rebel-alice",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 2,
    exhaustState: "exhausted",
  });
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [source],
      playerOverrides: ["alice", "bob"].map(() => ({
        lifeNormalCoreCount: 4,
        trashNormalCoreCount: 1,
        reserveNormalCoreCount: 2,
        soulCoreLocation: { kind: "trash" },
      })),
    }),
    battleEntities: [
      {
        entityId: "battle-entity:rebel-alice",
        memberInstanceIds: [source.instanceId],
        resolvedBp: 10000,
        resolvedSymbols: ["yellow"],
        attackState: "attacking",
      },
    ],
    activePlayerId: owner,
    turnNumber: 5,
    step: "main",
  };
  for (const duration of ["turn", "game"] as const) {
    state = {
      ...state,
      effectUsageRecords: recordEffectUsage({
        state,
        playerId: owner,
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: def.cardNo,
        effectLabel: "effect:1",
        duration,
      }),
    };
  }
  state = { ...state, step: "attack", window: "declare_attack" };
  const lookups = {
    getCardDefinitionById: (id: string) =>
      cards.find((card) => card.cardNo === id),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(cards),
    getRegisteredTriggeredEffectActions: () => undefined,
    getRegisteredFieldCardEffectActions: () => undefined,
  };
  state = queueRegisteredBattleImmediateEffects({
    state,
    attackId: "alice-text-attack",
    participantEntityId: "battle-entity:rebel-alice",
    actingPlayerId: owner,
    sourceCard: source,
    sourceDefinition: def,
    timing: "attack",
    ...lookups,
  });
  if (params?.get("stage") === "queued") return state;
  const action = getLegalActions({
    state,
    actingPlayerId: owner,
    ...lookups,
  }).find(
    (candidate) =>
      candidate.kind === "resolve_battle_immediate_effect" &&
      !candidate.skipOnly
  );
  if (!action) throw new Error("反逆者アリスのライフ回復効果を宣言できません");
  return applyLegalAction({ state, action, ...lookups }).state;
}
