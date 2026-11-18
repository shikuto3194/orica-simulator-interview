/**
 * BSSL01-X03 ベリオン effects[2,3] — フラッシュ〔ターンに1回:同名〕「自分のカウント7以上
 * のとき、自分の『水篠 旬』がいれば、手札/トラッシュ/煌臨元にあるこのカードは、召喚できる」。
 *
 * engine-advent-source-summon-permission: 条件付き複数ゾーン(手札/トラッシュ/煌臨元)
 * フラッシュ自己召喚起動効果。hand activated registration の applicability.zone に
 * "advent_source" を含め、getAvailableHandActivatedEffectLegalActions が
 * collectUnderCardScopeIds().adventSource 経由で煌臨元カードも候補に合流する。
 * 実行側は executeSummonSelf の「既にフィールドにいる場合は何もしない」ガードを
 * 煌臨元アンダーカードでは素通りし、ホスト側 underCards 参照を剥がしてから通常の
 * 召喚初期化（zone:"field"/cores=0/exhaustState:"recovered"）を適用する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildHandActivatedEffectLookup,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, CardInstance, GameState } from "../src";

const defMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getDef = (id: string) => defMap.get(id);
const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  defMap.get(id);

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};

const PLAYER = "p1";
const OPPONENT = "p2";

function actionsFor(state: GameState, actingPlayerId: string) {
  return getLegalActions({
    state,
    actingPlayerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}

function passStackUntilClosed(state: GameState): GameState {
  let current = state;
  let guard = 0;
  while (
    (current.stackWindow ||
      current.activeAttack?.flashWindowState?.pendingStackAction) &&
    guard++ < 10
  ) {
    const responderId =
      current.stackWindow?.priorityPlayerId ??
      current.activeAttack?.flashWindowState.priorityPlayerId;
    if (!responderId) {
      throw new Error("stack responder not found");
    }
    const pass = actionsFor(current, responderId).find(
      (action) =>
        action.kind === "pass_stack" || action.kind === "pass_battle_flash"
    );
    if (!pass) {
      throw new Error(`stack pass action not found: ${responderId}`);
    }
    current = applyLegalAction({
      state: current,
      action: pass,
      getCardDefinitionById,
      ...effectLookups,
    }).state;
  }
  return current;
}

/** ベリオン(X03)を「水篠 旬」(CX01)の煌臨元アンダーカードとして配置した state を作る。 */
function stateWithAdventSourceVerion(
  countValue: number,
  reserveNormalCoreCount?: number
): {
  state: GameState;
  x03InstanceId: string;
  hostInstanceId: string;
} {
  const x03InstanceId = "x03-verion";
  const hostInstanceId = "host-mizushino";
  const x03Instance: CardInstance = createCardInstance(getDef("BSSL01-X03")!, {
    instanceId: x03InstanceId,
    ownerPlayerId: PLAYER,
    controllerPlayerId: PLAYER,
    zone: "field",
  });
  const hostInstance: CardInstance = createCardInstance(
    getDef("BSSL01-CX01")!,
    {
      instanceId: hostInstanceId,
      ownerPlayerId: PLAYER,
      controllerPlayerId: PLAYER,
      zone: "field",
      normalCoreCount: 1,
    }
  );
  hostInstance.underCards = [
    { cardInstanceId: x03InstanceId, role: "advent_source" as const },
  ];
  const state = createEmptyGameState({
    playerIds: [PLAYER, OPPONENT],
    cardInstances: [
      x03Instance,
      hostInstance,
      createCardInstance(getDef("BSSL01-C01")!, {
        instanceId: "opponent-attacker",
        ownerPlayerId: OPPONENT,
        controllerPlayerId: OPPONENT,
        zone: "field",
        normalCoreCount: 1,
        exhaustState: "exhausted",
      }),
    ],
    battleEntities: [
      {
        entityId: "battle-entity:opponent-attacker",
        memberInstanceIds: ["opponent-attacker"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:opponent:battle-entity:opponent-attacker",
      primaryEntityId: "battle-entity:opponent-attacker",
      participantEntityIds: ["battle-entity:opponent-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: PLAYER },
      blockAssignments: [],
      symbolResolutionOrder: ["battle-entity:opponent-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: PLAYER,
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: PLAYER,
        pendingStackAction: null,
      },
    },
  });
  const withCount: GameState = {
    ...state,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: OPPONENT,
    players: state.players.map((p) =>
      p.id === PLAYER
        ? {
            ...p,
            countValue,
            ...(reserveNormalCoreCount !== undefined
              ? { reserveNormalCoreCount }
              : {}),
          }
        : p
    ),
  };
  return { state: withCount, x03InstanceId, hostInstanceId };
}

describe("煌臨元からの条件付きフラッシュ自己召喚起動効果 (BSSL01-X03 effects[2,3])", () => {
  it("カウント7以上＋『水篠 旬』在場: 煌臨元のベリオンに手札起動効果 legal action が出る", () => {
    const { state, x03InstanceId } = stateWithAdventSourceVerion(7);
    const actions = actionsFor(state, PLAYER);
    const action = actions.find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === x03InstanceId
    );
    expect(action).toMatchObject({
      effectIndex: 1,
      chosenTiming: "flash",
      sourceActivationZone: "advent_source",
    });
  });

  it("カウント6以下: 煌臨元のベリオンに手札起動効果 legal action が出ない", () => {
    const { state, x03InstanceId } = stateWithAdventSourceVerion(6);
    const actions = actionsFor(state, PLAYER);
    const action = actions.find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === x03InstanceId
    );
    expect(action).toBeUndefined();
  });

  it("起動効果を適用: ベリオンが独立した場のカードになり、ホストの煌臨元参照が剥がれる", () => {
    const { state, x03InstanceId, hostInstanceId } =
      stateWithAdventSourceVerion(7, 20);
    const actions = actionsFor(state, PLAYER);
    const action = actions.find(
      (a) =>
        a.kind === "use_hand_card_effect" &&
        a.sourceInstanceId === x03InstanceId
    );
    expect(action).toBeDefined();
    if (!action || action.kind !== "use_hand_card_effect") {
      throw new Error("BSSL01-X03 advent-source hand effect action not found");
    }

    const afterDeclare = applyLegalAction({
      state,
      action,
      getCardDefinitionById,
      ...effectLookups,
      summonPaymentSources: [{ kind: "reserve", amount: 4 }],
      summonEnterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    expect(afterDeclare.window).toBe("stack_before_block");
    expect(
      afterDeclare.activeAttack?.flashWindowState?.pendingStackAction
        ?.actionKind
    ).toBe("hand_card_effect");
    expect(
      afterDeclare.players.find((p) => p.id === PLAYER)?.reserveNormalCoreCount
    ).toBe(20);
    const afterPass = passStackUntilClosed(afterDeclare);

    const summoned = afterPass.cardInstances.find(
      (c) => c.instanceId === x03InstanceId
    );
    expect(summoned?.zone).toBe("field");
    expect(summoned?.normalCoreCount).toBe(1);
    expect(
      afterPass.players.find((p) => p.id === PLAYER)?.reserveNormalCoreCount
    ).toBe(15);

    const host = afterPass.cardInstances.find(
      (c) => c.instanceId === hostInstanceId
    );
    expect(
      host?.underCards.some((entry) => entry.cardInstanceId === x03InstanceId)
    ).toBe(false);
  });
});
