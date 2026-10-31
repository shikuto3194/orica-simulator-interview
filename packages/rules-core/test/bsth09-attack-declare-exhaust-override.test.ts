/**
 * engine-attack-declare-exhaust-override cluster: BSTH09-C03/C04 が要求する
 * 「アタック宣言時の exhaustState 遷移」への2種の例外。
 *
 * - allow_attack_while_exhausted (BSTH09-C04【追撃】): 疲労状態のこのスピリットは、
 *   重疲労させることでアタック宣言できる（回復状態のみアタック宣言可という通常前提の例外）。
 *   宣言確定時の疲労遷移は通常の「疲労」ではなく「重疲労」になる。対象は疲労状態のみで
 *   重疲労状態は対象外。
 * - allow_tapless_battle_declare (BSTH09-C03): ターンに1回、疲労せずにアタック/ブロック宣言
 *   できる。宣言の前提条件（回復状態が必要）は変えず、宣言確定時に本来発生する疲労遷移だけを
 *   スキップする。アタック/ブロックは共有の同一ターン予算 (1回)。
 */
import { describe, expect, it } from "vitest";
import {
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  useAttackAsAction,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src/index";
import { getAttackDeclarationBlockReason } from "../src/battle/battle-availability";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";
import type { ActiveAttack, CardDefinition, GameState } from "../src/index";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);

function makeSpirit(
  cardNo: string,
  effects: CardDefinition["effects"] = []
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    tribe: "test",
    sourceUrls: [],
    sourceConfidence: "C",
    effects,
  };
}

const PLAIN_DEF = makeSpirit("TEST-ADEO-PLAIN");
const TSUIGEKI_DEF = makeSpirit("TEST-ADEO-TSUIGEKI", [
  {
    timing: { kind: "continuous" },
    steps: [
      {
        action: {
          kind: "allow_attack_while_exhausted",
          target: { kind: "self" },
          duration: { scope: "while_on_field" },
        },
      },
    ],
    textRef: [0],
  },
]);
const TAPLESS_DEF = makeSpirit("TEST-ADEO-TAPLESS", [
  {
    timing: { kind: "continuous" },
    steps: [
      {
        action: {
          kind: "allow_tapless_battle_declare",
          target: { kind: "self" },
          duration: { scope: "while_on_field" },
        },
      },
    ],
    textRef: [0],
  },
]);
const BLOCKER_DEF = makeSpirit("TEST-ADEO-BLOCKER");

const testCardMap = new Map<string, CardDefinition>(
  [PLAIN_DEF, TSUIGEKI_DEF, TAPLESS_DEF, BLOCKER_DEF].map((d) => [d.cardNo, d])
);
const getCardDefinitionById = (id: string) =>
  testCardMap.get(id) ?? cardNoMap.get(id);

function buildAttackState(opts: {
  def: CardDefinition;
  exhaustState: "recovered" | "exhausted" | "heavily_exhausted";
  usedTaplessBattleDeclareInstanceIdsThisTurn?: readonly string[];
}): GameState {
  const state: GameState = {
    ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
    activePlayerId: "alice",
    step: "attack",
    window: "none",
    activeAttack: null,
    cardInstances: [
      createCardInstance(opts.def, {
        instanceId: "attacker-1",
        ownerPlayerId: "alice",
        controllerPlayerId: "alice",
        zone: "field",
        cores: 1,
        exhaustState: opts.exhaustState,
      }),
    ],
    usedTaplessBattleDeclareInstanceIdsThisTurn: [
      ...(opts.usedTaplessBattleDeclareInstanceIdsThisTurn ?? []),
    ],
  };
  return rebuildContinuousEffectsFromField(state, getCardDefinitionById);
}

function declareAndConfirmAttack(state: GameState): GameState {
  const tentative = useAttackAsAction({
    state,
    actingPlayerId: "alice",
    sourceInstanceId: "attacker-1",
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
    getRegisteredBurstActions: undefined,
  });
  const afterPass = usePassPreDeclarationStackAsAction({
    state: tentative,
    actingPlayerId: "bob",
  });
  const result = confirmAttackDeclarationAsAction(
    afterPass.closedWindow!,
    afterPass.state,
    { getCardDefinitionById }
  );
  return result.state;
}

describe("BSTH09-C04【追撃】allow_attack_while_exhausted", () => {
  it("card-data: effects[1] は allow_attack_while_exhausted で stub 無し", () => {
    const card = cardNoMap.get("BSTH09-C04")!;
    const effect = card.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.steps[0]!.action.kind).toBe("allow_attack_while_exhausted");
  });

  it("CE 無し・疲労状態は通常通りアタック宣言不可 (source_not_ready、ベースライン)", () => {
    const state = buildAttackState({
      def: PLAIN_DEF,
      exhaustState: "exhausted",
    });
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
  });

  it("CE 有り・疲労状態はアタック宣言合法 (source_not_ready をバイパス)", () => {
    const state = buildAttackState({
      def: TSUIGEKI_DEF,
      exhaustState: "exhausted",
    });
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBeNull();
  });

  it("CE 有りでも重疲労状態はアタック宣言不可（対象は疲労状態のみ）", () => {
    const state = buildAttackState({
      def: TSUIGEKI_DEF,
      exhaustState: "heavily_exhausted",
    });
    expect(
      getAttackDeclarationBlockReason({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById,
      })
    ).toBe("source_not_ready");
  });

  it("疲労状態からアタック宣言を確定すると、重疲労させることを対価として消費する（盤面変化）", () => {
    const state = buildAttackState({
      def: TSUIGEKI_DEF,
      exhaustState: "exhausted",
    });
    const declared = declareAndConfirmAttack(state);

    expect(declared.activeAttack).not.toBeNull();
    expect(
      declared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("heavily_exhausted");
  });

  it("CE を持たない回復状態のアタック宣言は通常通り疲労状態へ遷移する（回帰防止）", () => {
    const state = buildAttackState({
      def: TSUIGEKI_DEF,
      exhaustState: "recovered",
    });
    const declared = declareAndConfirmAttack(state);
    expect(
      declared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });
});

describe("BSTH09-C03 allow_tapless_battle_declare", () => {
  it("card-data: effects[1] は allow_tapless_battle_declare で stub 無し", () => {
    const card = cardNoMap.get("BSTH09-C03")!;
    const effect = card.effects![1]!;
    expect(effect.stub).toBeUndefined();
    expect(effect.steps[0]!.action.kind).toBe("allow_tapless_battle_declare");
  });

  it("回復状態でアタック宣言を確定すると、疲労遷移をスキップして回復状態のまま残る（タップ無しアタック）", () => {
    const state = buildAttackState({
      def: TAPLESS_DEF,
      exhaustState: "recovered",
    });
    const declared = declareAndConfirmAttack(state);

    expect(declared.activeAttack).not.toBeNull();
    expect(
      declared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("recovered");
    expect(declared.usedTaplessBattleDeclareInstanceIdsThisTurn).toEqual([
      "attacker-1",
    ]);
  });

  it("ターンに1回制限: 同ターン2回目のアタック宣言は通常通り疲労する", () => {
    const firstDeclared = declareAndConfirmAttack(
      buildAttackState({ def: TAPLESS_DEF, exhaustState: "recovered" })
    );
    expect(
      firstDeclared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("recovered");

    // 1戦目終了後、同じカードが (回復状態のまま) 再度アタックを宣言する状況を模す。
    const beforeSecondAttack: GameState = {
      ...firstDeclared,
      activeAttack: null,
      window: "none",
    };
    const secondDeclared = declareAndConfirmAttack(beforeSecondAttack);

    expect(
      secondDeclared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("CE を持たない回復状態のアタック宣言は通常通り疲労状態へ遷移する（回帰防止）", () => {
    const declared = declareAndConfirmAttack(
      buildAttackState({ def: PLAIN_DEF, exhaustState: "recovered" })
    );
    expect(
      declared.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("回復状態でブロック宣言を確定すると、疲労遷移をスキップして回復状態のまま残る（タップ無しブロック）", () => {
    const attacker = createCardInstance(PLAIN_DEF, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      cores: 1,
      exhaustState: "exhausted",
    });
    const blocker = createCardInstance(TAPLESS_DEF, {
      instanceId: "blocker-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
      exhaustState: "recovered",
    });
    const activeAttack: ActiveAttack = {
      attackId: "attack:be-1:1",
      primaryEntityId: "be-1",
      participantEntityIds: ["be-1"],
      groupMode: "single",
      target: { kind: "player", playerId: "bob" },
      blockAssignments: [
        { participantEntityId: "be-1", blockedByEntityIds: [] },
      ],
      symbolResolutionOrder: ["be-1"],
      flashBeforeBlockCompleted: true,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    };
    const stateBeforeBattle: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [attacker, blocker],
      }),
      turnNumber: 2,
      activePlayerId: "alice",
      step: "attack",
    };
    const stateWithCEs = rebuildContinuousEffectsFromField(
      stateBeforeBattle,
      getCardDefinitionById
    );
    const state: GameState = {
      ...stateWithCEs,
      window: "declare_attack",
      activeAttack,
      battleEntities: [
        {
          entityId: "be-1",
          resolvedBp: 3000,
          attackState: "attacking",
          resolvedSymbols: ["red"],
          memberInstanceIds: ["attacker-1"],
        },
      ],
    };

    const tentative = useBlockAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "be-1",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "alice",
    });
    const confirmed = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById }
    );

    expect(
      confirmed.state.cardInstances.find((c) => c.instanceId === "blocker-1")
        ?.exhaustState
    ).toBe("recovered");
    expect(confirmed.state.usedTaplessBattleDeclareInstanceIdsThisTurn).toEqual(
      ["blocker-1"]
    );
  });
});
