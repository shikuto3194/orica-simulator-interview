import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildBurstEffectLookup,
  buildFieldCardEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** 公式Q1481: 防げないフラッシュに対する、咲夜の発揮前チェックポイント。 */
export function buildSakuyaUnpreventableScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const defs = new Map(allCards.map((card) => [card.cardNo, card]));
  const lookups = {
    getCardDefinitionById: (id: string) => defs.get(id),
    getRegisteredMagicActions: buildMagicLookup(allCards),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    getRegisteredBattleImmediateEffectActions:
      buildBattleImmediateEffectLookup(allCards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(allCards),
    getRegisteredBurstActions: buildBurstEffectLookup(allCards),
  };
  const cards = [
    createCardInstance(defs.get("BSSA01-C03")!, {
      instanceId: "q1481-attacker",
      ownerPlayerId: owner,
      zone: "field",
      cores: 1,
    }),
    createCardInstance(defs.get("BSTH01-X05")!, {
      instanceId: "q1481-sakuya",
      ownerPlayerId: owner,
      zone: "hand",
    }),
    createCardInstance(defs.get("BSTH04-C11")!, {
      instanceId: "q1481-magic",
      ownerPlayerId: opponent,
      zone: "hand",
    }),
  ];
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: cards,
    playerOverrides: ["alice", "bob"].map((id) => ({
      id,
      reserveNormalCoreCount: 8,
      countValue: id === opponent ? 2 : 0,
    })),
    battleEntities: [
      {
        entityId: "q1481-entity",
        memberInstanceIds: ["q1481-attacker"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "q1481-attack",
      primaryEntityId: "q1481-entity",
      participantEntityIds: ["q1481-entity"],
      groupMode: "single",
      target: { kind: "player", playerId: opponent },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: opponent,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: opponent,
        pendingStackAction: null,
      },
    },
  });
  let state: GameState = {
    ...base,
    activePlayerId: owner,
    step: "attack",
    window: "flash_before_block",
    turnNumber: 3,
  };
  const flash = getLegalActions({
    state,
    actingPlayerId: opponent,
    ...lookups,
  }).find((action) => action.kind === "use_magic" && action.timing === "flash");
  if (!flash) throw new Error("Q1481 scenario: flash unavailable");
  state = applyLegalAction({
    state,
    action: flash,
    paymentSources: [{ kind: "reserve", amount: 4 }],
    ...lookups,
  }).state;
  for (let i = 0; i < 4; i++) {
    const actions = getLegalActions({
      state,
      actingPlayerId: owner,
      ...lookups,
    });
    if (
      actions.some(
        (action) => action.kind === "declare_private_triggered_effect"
      )
    )
      return state;
    const pass = actions.find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );
    if (!pass) break;
    state = applyLegalAction({ state, action: pass, ...lookups }).state;
  }
  throw new Error("Q1481 scenario: private checkpoint unavailable");
}
