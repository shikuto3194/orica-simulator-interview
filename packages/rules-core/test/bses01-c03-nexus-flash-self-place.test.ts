/**
 * BSES01-C03 迎撃砲 (ネクサス) の自己フラッシュ配置解禁:
 *   フラッシュ『お互いのアタックステップ』「手札/手元にあるこのカードは、配置できる。」
 *
 * 検証:
 *  - 即時型の自己配置は hand-activated effect として use_hand_card_effect を生成する。
 *  - timingScope=both/attack のため、窓を開いた直後は非アクティブ側 (bob) は自分の
 *    ネクサスを配置でき、優先権が alice に移った後は alice も配置できる。
 *  - 配置宣言で対象ネクサスが in_use へ移り、コスト支払いはスタック窓後に行われる。
 *  - timingScope 外 (メインステップ) では手札起動効果は提示されない。
 *
 * ルール根拠: カード本文 (独自カード source precedence)。フラッシュ優先権ループは
 *   20_design/08_stack-window-and-priority-loop.md / 10_rules/02_turn-flow-and-timing.md。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  buildBattleImmediateEffectLookup,
  buildHandActivatedEffectLookup,
  createCardInstance,
  createEmptyGameState,
  getLegalActions,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
// C03: ネクサス cost3 / 軽減 white,yellow / requiredCores 0。
const C03 = cardNoMap.get("BSES01-C03")!;

function makeSimpleSpirit(cardNo: string, bp: number): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const ATTACKER = makeSimpleSpirit("TEST-ATTACKER", 2000);

const getCardDefinitionById = (id: string): CardDefinition | undefined =>
  cardNoMap.get(id) ?? (id === ATTACKER.cardNo ? ATTACKER : undefined);

const effectLookups = {
  getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(ALL_CARDS),
  getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(ALL_CARDS),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(ALL_CARDS),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(ALL_CARDS),
};

function actionsFor(state: GameState, playerId: string) {
  return getLegalActions({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
    ...effectLookups,
  });
}

/** flash_before_block を開いた直後 (最初の優先権 = 非アクティブ bob)。 */
function setupFlashBeforeBlock(): GameState {
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(ATTACKER, {
        instanceId: "alice-attacker",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: "exhausted",
      }),
      // alice: 手札に C03 (ネクサス, 通常コスト)。
      createCardInstance(C03, {
        instanceId: "alice-c03",
        ownerPlayerId: "alice",
        zone: "hand",
      }),
      // bob: 手札に C03 (ネクサス, 通常コスト)。
      createCardInstance(C03, {
        instanceId: "bob-c03",
        ownerPlayerId: "bob",
        zone: "hand",
      }),
    ],
    playerOverrides: [
      { deckCount: 5, reserveNormalCoreCount: 5 },
      { deckCount: 5, reserveNormalCoreCount: 5 },
    ],
    battleEntities: [
      {
        entityId: "battle-entity:alice-attacker",
        memberInstanceIds: ["alice-attacker"],
        resolvedBp: 2000,
        resolvedSymbols: ["red"],
        attackState: "attacking",
      },
    ],
    activeAttack: {
      attackId: "attack-group:2:alice:battle-entity:alice-attacker",
      primaryEntityId: "battle-entity:alice-attacker",
      participantEntityIds: ["battle-entity:alice-attacker"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:alice-attacker",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:alice-attacker"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: {
        kind: "before_block",
        priorityPlayerId: "bob",
        consecutivePassCount: 0,
        stackResponseSourcePlayerId: "bob",
        pendingStackAction: null,
      },
    },
  });
  return {
    ...base,
    step: "attack",
    window: "flash_before_block",
    activePlayerId: "alice",
    turnNumber: 2,
  };
}

function passBattleFlash(state: GameState, playerId: string): GameState {
  const pass = actionsFor(state, playerId).find(
    (a) => a.kind === "pass_battle_flash"
  );
  expect(pass).toBeDefined();
  return applyLegalAction({
    state,
    action: pass!,
    getCardDefinitionById,
    ...effectLookups,
  }).state;
}

describe("BSES01-C03 迎撃砲: フラッシュ『お互いのアタックステップ』ネクサス自己配置", () => {
  it("窓を開いた直後、非アクティブ bob が自分のネクサスを手札起動効果で配置できる", () => {
    const state = setupFlashBeforeBlock();
    const bobActions = actionsFor(state, "bob");

    const handEffects = bobActions.filter(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "bob-c03"
    ) as Array<
      Extract<(typeof bobActions)[number], { kind: "use_hand_card_effect" }>
    >;

    expect(handEffects.length).toBe(1);
    expect(handEffects[0]).toMatchObject({
      effectIndex: 0,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });
  });

  it("窓を開いた直後、優先権のない alice には手札起動効果が提示されない", () => {
    const state = setupFlashBeforeBlock();
    expect(state.activeAttack?.flashWindowState?.priorityPlayerId).toBe("bob");

    const aliceActions = actionsFor(state, "alice");
    expect(
      aliceActions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          a.sourceInstanceId === "alice-c03"
      )
    ).toBe(false);
  });

  it("手札フラッシュ使用禁止中は hand の起動効果だけ止まり、set_aside は提示される", () => {
    const state = setupFlashBeforeBlock();
    const restrictBobHandFlash: ContinuousEffect = {
      effectId: "ce:restrict-flash-hand:bob",
      sourceInstanceId: "alice-attacker",
      sourceDefinitionId: ATTACKER.cardNo,
      actingPlayerId: "alice",
      duration: { scope: "battle" },
      createdAtTurn: state.turnNumber,
      createdAtAttackId: state.activeAttack?.attackId ?? null,
      modifierTag: "restrict_flash_hand",
      targetInstanceId: "bob",
      metadata: { restrictedZones: ["hand"] },
    };
    const restrictedState: GameState = {
      ...state,
      activeContinuousEffects: [
        ...state.activeContinuousEffects,
        restrictBobHandFlash,
      ],
    };

    const bobActions = actionsFor(restrictedState, "bob");
    expect(
      bobActions.some(
        (a) =>
          a.kind === "use_hand_card_effect" && a.sourceInstanceId === "bob-c03"
      )
    ).toBe(false);

    const setAsideRestrictedState: GameState = {
      ...restrictedState,
      cardInstances: [
        ...restrictedState.cardInstances,
        createCardInstance(C03, {
          instanceId: "bob-c03-set-aside",
          ownerPlayerId: "bob",
          zone: "set_aside",
        }),
      ],
    };
    const bobSetAsideActions = actionsFor(setAsideRestrictedState, "bob");
    expect(
      bobSetAsideActions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          a.sourceInstanceId === "bob-c03-set-aside"
      )
    ).toBe(true);
  });

  it("優先権が alice に移った後、alice は手札のネクサスを配置できる", () => {
    const afterBobPass = passBattleFlash(setupFlashBeforeBlock(), "bob");
    expect(afterBobPass.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    const aliceActions = actionsFor(afterBobPass, "alice");
    const c03 = aliceActions.find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "alice-c03"
    ) as
      | Extract<(typeof aliceActions)[number], { kind: "use_hand_card_effect" }>
      | undefined;

    expect(c03).toMatchObject({
      effectIndex: 0,
      chosenTiming: "flash",
      sourceActivationZone: "hand",
    });
  });

  it("アタックステップ中でもフラッシュ窓でなければ手札起動効果は提示されない", () => {
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(C03, {
            instanceId: "alice-c03",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
      }),
      step: "attack",
      activePlayerId: "alice",
      window: null,
      activeAttack: null,
    };

    const actions = actionsFor(state, "alice");
    expect(
      actions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          a.sourceInstanceId === "alice-c03"
      )
    ).toBe(false);
  });

  it("配置宣言で対象ネクサスが in_use へ移り、コスト支払いは窓後に行われる", () => {
    const afterBobPass = passBattleFlash(setupFlashBeforeBlock(), "bob");
    const c03 = actionsFor(afterBobPass, "alice").find(
      (a) =>
        a.kind === "use_hand_card_effect" && a.sourceInstanceId === "alice-c03"
    )!;

    const applied = applyLegalAction({
      state: afterBobPass,
      action: c03,
      getCardDefinitionById,
      ...effectLookups,
      summonPaymentSources: [{ kind: "reserve", amount: 3 }],
    }).state;

    expect(
      applied.cardInstances.find((c) => c.instanceId === "alice-c03")?.zone
    ).toBe("in_use");
    expect(
      applied.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(5);
    // フラッシュ本体の内側にスタックサブ窓が開いている (手札起動効果の解決待ち)。
    expect(applied.window).toBe("stack_before_block");
    expect(
      applied.activeAttack?.flashWindowState?.pendingStackAction?.actionKind
    ).toBe("hand_card_effect");

    const resolved = passBattleFlash(applied, "bob");
    expect(resolved.window).toBe("flash_before_block");
    expect(resolved.activeAttack?.flashWindowState).toMatchObject({
      pendingStackAction: null,
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
    });
    expect(
      resolved.cardInstances.find((c) => c.instanceId === "alice-c03")?.zone
    ).toBe("field");
    expect(
      resolved.players.find((p) => p.id === "alice")?.reserveNormalCoreCount
    ).toBe(2);
    expect(resolved.stackWindow).toBeNull();
    expect(resolved.pendingEnterFieldPlacement).toBeNull();
    expect(resolved.window).not.toBe("stack");
    expect(resolved.window).not.toBe("stack_before_block");
  });

  it("timingScope 外 (メインステップ) では手札起動効果は提示されない", () => {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(C03, {
          instanceId: "alice-c03",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }, {}],
    });
    const mainState: GameState = {
      ...base,
      step: "main",
      activePlayerId: "alice",
    };
    const actions = actionsFor(mainState, "alice");
    expect(
      actions.some(
        (a) =>
          a.kind === "use_hand_card_effect" &&
          a.sourceInstanceId === "alice-c03"
      )
    ).toBe(false);
  });
});
