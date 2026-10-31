/**
 * BSDB01-C09「かめはめ波」effects[2] (textRef[5,6]):
 *   「スタック
 *    次のバトル終了後まで、相手は、相手のスピリット/アルティメット1体を破壊しなければ、
 *    アタック/ブロックできない。」
 *
 * 「相手は、相手の〜」= 相手自身の場を対象にする自己言及パターン (相手が自分自身の
 * スピリット/アルティメットを破壊する)。新設プリミティブ require_battle_destroy_cost
 * (require_attack_exhaust_cost の破壊版) で表現する: 対象自身と同じ controller の
 * costTargetFilter.category 合致カード1体を破壊しなければアタック/ブロック宣言できない。
 * battle-availability.ts の isAttackPreventedByCE/isBlockPreventedByCE に
 * isBattleDestroyCostGateUnaffordable として配線し、battle-actions.ts の
 * useAttackAsAction/useBlockAsAction (宣言時、pre_declaration_stack window を開く前) が
 * 選択された破壊コスト源を executeDestroy で実際に破壊する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  applyLegalAction,
  buildBattleImmediateEffectLookup,
  buildFieldCardEffectLookup,
  buildHandActivatedEffectLookup,
  buildMagicLookup,
  buildTriggeredEffectLookup,
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
  confirmJoinActiveAttackDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
  getLegalActions,
  useAttackAsAction,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src";
import { removeExpiredContinuousEffects } from "../src/legal/legal-actions-shared";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C09 = cardNoMap.get("BSDB01-C09")!;

function makeSpirit(cardNo: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["red"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const ALICE_ATTACKER = makeSpirit("TEST-C09-ALICE-ATTACKER");
const BOB_SOURCE = makeSpirit("TEST-C09-BOB-SOURCE");
const BOB_OTHER = makeSpirit("TEST-C09-BOB-OTHER");

const testCardMap = new Map<string, CardDefinition>([
  [ALICE_ATTACKER.cardNo, ALICE_ATTACKER],
  [BOB_SOURCE.cardNo, BOB_SOURCE],
  [BOB_OTHER.cardNo, BOB_OTHER],
]);
const getCardDefinitionByIdWithSpirits = (id: string) =>
  cardNoMap.get(id) ?? testCardMap.get(id);

const allTestDefinitions = [...ALL_CARDS, ...testCardMap.values()];
const effectLookups = {
  getCardDefinitionById: getCardDefinitionByIdWithSpirits,
  getRegisteredFieldCardEffectActions:
    buildFieldCardEffectLookup(allTestDefinitions),
  getRegisteredTriggeredEffectActions:
    buildTriggeredEffectLookup(allTestDefinitions),
  getRegisteredBattleImmediateEffectActions:
    buildBattleImmediateEffectLookup(allTestDefinitions),
  getRegisteredHandActivatedEffectActions:
    buildHandActivatedEffectLookup(allTestDefinitions),
  getRegisteredMagicActions: buildMagicLookup(allTestDefinitions),
};

function findDestroyCostGateEffect(def: CardDefinition) {
  return def.effects!.find((e) =>
    e.steps.some((s) => s.action.kind === "require_battle_destroy_cost")
  )!;
}

describe("BSDB01-C09 effects[2]: スタック (require_battle_destroy_cost 新設)", () => {
  it("effect定義: timing:activated/stack + require_battle_destroy_cost 1step、restriction/target/costTargetFilter/duration が原文と一致", () => {
    const effect = findDestroyCostGateEffect(C09);
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });
    expect(effect.steps).toHaveLength(1);

    const action = effect.steps[0]!.action;
    expect(action.kind).toBe("require_battle_destroy_cost");
    if (action.kind !== "require_battle_destroy_cost")
      throw new Error("unreachable");
    expect(action.target).toEqual({
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit", "ultimate"] },
      count: "all",
    });
    expect(action.restriction).toEqual(["attack", "block"]);
    expect(action.costTargetFilter).toEqual({
      category: ["spirit", "ultimate"],
    });
    // 「次のバトル終了後まで」(原文にターン限定語なし) は scope:"battle" 単体
    // (このバトル中のみで battle_end に失効。round1 refute) でも untilTurnEnd:true
    // (「このターン中の」限定が原文に無いのに turn_end で早期失効させてしまう。round2 refute)
    // でも表現できない。ターン境界を跨いで生存し次の battle_end で失効する
    // nextBattleEnd:true (model.ts:790-797 に正規セマンティクスとして新設) を使う。
    expect(action.duration).toEqual({ scope: "battle", nextBattleEnd: true });
  });
});

describe("battle_destroy_cost_gate: nextBattleEnd により登録元バトルの終了後もターンを跨いで次バトルまでゲートが持続する", () => {
  function destroyCostGateCE(
    gatedPlayerId: string,
    createdAtAttackId: string | null,
    createdAtTurn = 1
  ): ContinuousEffect {
    return {
      effectId: "ce-battle-destroy-cost-gate-persistence-test",
      sourceInstanceId: "c09-magic",
      sourceDefinitionId: C09.cardNo,
      actingPlayerId: gatedPlayerId === "bob" ? "alice" : "bob",
      duration: { scope: "battle", nextBattleEnd: true },
      createdAtTurn,
      createdAtAttackId,
      modifierTag: "battle_destroy_cost_gate_both",
      targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
      metadata: { costTargetCategory: ["spirit", "ultimate"] },
    };
  }

  it("登録元バトル (attack-1) の battle_end では失効しない", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [destroyCostGateCE("bob", "attack-1")],
    };
    const afterOwnBattleEnd = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack-1",
    });
    expect(afterOwnBattleEnd).toHaveLength(1);
  });

  it("原文に「このターン中の」限定が無いため、次バトルがまだ来ていなければ turn_end を跨いでも失効しない (round2 refute の再発防止)", () => {
    // 登録元バトル (attack-1) 終了直後、同ターン内でまだ次バトルが発生していない状態で
    // ターンが終了しても (untilTurnEnd と異なり) 失効しない。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [destroyCostGateCE("bob", "attack-1", 1)],
    };
    const afterOwnBattleEnd = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack-1",
    });
    expect(afterOwnBattleEnd).toHaveLength(1);

    const afterTurnEnd = removeExpiredContinuousEffects(
      { ...state, activeContinuousEffects: afterOwnBattleEnd },
      { kind: "turn_end" }
    );
    expect(afterTurnEnd).toHaveLength(1);

    // さらに次のターンが始まってもまだ次バトルが起きていなければ生存し続ける。
    const afterAnotherTurnEnd = removeExpiredContinuousEffects(
      { ...state, activeContinuousEffects: afterTurnEnd, turnNumber: 2 },
      { kind: "turn_end" }
    );
    expect(afterAnotherTurnEnd).toHaveLength(1);
  });

  it("登録元バトル (attack-1) 終了後、次バトル (attack-2) の宣言時点でもゲートは有効", () => {
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    // attack-1 の battle_end を経た後 (CE は生存)、次の攻撃宣言 (attack-2 相当) の窓。
    const stateAfterFirstBattleEnd: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSource, bobOther],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: removeExpiredContinuousEffects(
        {
          ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
          activeContinuousEffects: [destroyCostGateCE("bob", "attack-1")],
        },
        { kind: "battle_end", attackId: "attack-1" }
      ),
    };
    expect(stateAfterFirstBattleEnd.activeContinuousEffects).toHaveLength(1);

    const reason = getAttackDeclarationBlockReason({
      state: stateAfterFirstBattleEnd,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBeNull();

    const tentative = useAttackAsAction({
      state: stateAfterFirstBattleEnd,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      battleDestroyCostSourceInstanceId: "bob-other",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const bobOtherAfterDeclare = tentative.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterDeclare.zone).toBe("trash");
  });

  it("次バトル (attack-2) の battle_end では失効する (次のバトル終了後まで、を超えたら消える)", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [destroyCostGateCE("bob", "attack-1")],
    };
    const afterSecondBattleEnd = removeExpiredContinuousEffects(state, {
      kind: "battle_end",
      attackId: "attack-2",
    });
    expect(afterSecondBattleEnd).toHaveLength(0);
  });
});

describe("battle_destroy_cost_gate: 破壊コスト候補の耐性判定は「破壊するプレイヤー自身」基準で行う", () => {
  function destroyCostGateCE(gatedPlayerId: string): ContinuousEffect {
    return {
      effectId: "ce-battle-destroy-cost-gate-resistance-test",
      sourceInstanceId: "c09-magic",
      sourceDefinitionId: C09.cardNo,
      actingPlayerId: gatedPlayerId === "bob" ? "alice" : "bob",
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "battle_destroy_cost_gate_both",
      targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
      metadata: { costTargetCategory: ["spirit", "ultimate"] },
    };
  }
  function cannotBeDestroyedByOpponentCE(
    targetInstanceId: string,
    ownerPlayerId: string
  ): ContinuousEffect {
    return {
      effectId: `ce-cannot-destroy-${targetInstanceId}`,
      sourceInstanceId: targetInstanceId,
      sourceDefinitionId: "test-def",
      actingPlayerId: ownerPlayerId,
      duration: { scope: "while_on_field" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_be_destroyed",
      targetInstanceId,
      metadata: { source: "opponent" },
    };
  }

  it("『相手の効果では破壊されない』耐性を持つ自分のカードでも、自分自身への破壊コスト支払いは有効な候補になる", () => {
    // BSDB01-C09 のゲートは alice (CE actingPlayerId) が課すが、実際に破壊を実行するのは
    // bob 自身 (自分のカードを自分で破壊するコスト)。bob-other が「相手 (alice) の効果では
    // 破壊されない」耐性 (metadata.source:"opponent") を持っていても、bob 自身による破壊は
    // 相手の効果ではないため耐性は適用されず、候補から除外されてはならない。
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSource, bobOther],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [
        destroyCostGateCE("bob"),
        cannotBeDestroyedByOpponentCE("bob-other", "bob"),
      ],
    };

    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBeNull();

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      battleDestroyCostSourceInstanceId: "bob-other",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const bobOtherAfterDeclare = tentative.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterDeclare.zone).toBe("trash");
  });
});

describe("BSDB01-C09: battle_destroy_cost_gate によるアタック/ブロック宣言ゲート", () => {
  function destroyCostGateCE(gatedPlayerId: string): ContinuousEffect {
    return {
      effectId: "ce-battle-destroy-cost-gate-test",
      sourceInstanceId: "c09-magic",
      sourceDefinitionId: C09.cardNo,
      actingPlayerId: gatedPlayerId === "bob" ? "alice" : "bob",
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "battle_destroy_cost_gate_both",
      targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
      metadata: { costTargetCategory: ["spirit", "ultimate"] },
    };
  }

  it("同じcontrollerの破壊候補が無ければアタック宣言不可 (source_not_ready)", () => {
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSource],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBe("source_not_ready");
  });

  it("破壊候補が存在すれば宣言可能。破壊コスト源を選ばずに宣言するとエラー", () => {
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSource, bobOther],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBeNull();

    expect(() =>
      useAttackAsAction({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "bob-source",
        getCardDefinitionById: getCardDefinitionByIdWithSpirits,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      })
    ).toThrow(/destroy cost source/);
  });

  it("破壊コスト源を選んで宣言すると選択したカードが破壊(トラッシュ移動)され、宣言が確定する", () => {
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSource, bobOther],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      battleDestroyCostSourceInstanceId: "bob-other",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    // 破壊コストは宣言時 (pre_declaration_stack window を開く前) に即実行される。
    const bobOtherAfterDeclare = tentative.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterDeclare.zone).toBe("trash");
    const bobSourceAfterDeclare = tentative.cardInstances.find(
      (c) => c.instanceId === "bob-source"
    )!;
    expect(bobSourceAfterDeclare.zone).toBe("field");

    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "alice",
    });
    const result = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getCardDefinitionByIdWithSpirits }
    );
    // 破壊コストを支払った bob-source のアタック宣言自体はエラーなく確定している。
    expect(result.attackId).toBeDefined();
    const bobSourceAfterConfirm = result.state.cardInstances.find(
      (c) => c.instanceId === "bob-source"
    )!;
    expect(bobSourceAfterConfirm.exhaustState).toBe("exhausted");
  });

  it("破壊候補が無ければブロック宣言不可 (source_not_ready)", () => {
    const attacker = createCardInstance(ALICE_ATTACKER, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [attacker, bobSource],
      step: "attack",
      window: "declare_attack",
      activePlayerId: "alice",
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
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
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };
    const reason = getBlockDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      participantEntityId: "battle-entity:alice-attacker",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBe("source_not_ready");
  });

  it("破壊コスト源を選んでブロック宣言すると選択したカードが破壊される", () => {
    const attacker = createCardInstance(ALICE_ATTACKER, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [attacker, bobSource, bobOther],
      step: "attack",
      window: "declare_attack",
      activePlayerId: "alice",
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
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
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };

    expect(() =>
      useBlockAsAction({
        state,
        actingPlayerId: "bob",
        sourceInstanceId: "bob-source",
        participantEntityId: "battle-entity:alice-attacker",
        getCardDefinitionById: getCardDefinitionByIdWithSpirits,
        getRegisteredTriggeredEffectActions: () => [],
        getRegisteredBurstActions: undefined,
      })
    ).toThrow(/destroy cost source/);

    const tentative = useBlockAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-source",
      participantEntityId: "battle-entity:alice-attacker",
      battleDestroyCostSourceInstanceId: "bob-other",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    const bobOtherAfterDeclare = tentative.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterDeclare.zone).toBe("trash");

    // 破壊コスト支払い済みでも confirm 時の再検証 (legality-changed) が
    // battle_destroy_cost_gate を誤って unaffordable 判定し宣言をキャンセルしないこと。
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "alice",
    });
    const result = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getCardDefinitionByIdWithSpirits }
    );
    expect(result.blockerEntityId).not.toBe("");
    const bobSourceAfterConfirm = result.state.cardInstances.find(
      (c) => c.instanceId === "bob-source"
    )!;
    expect(bobSourceAfterConfirm.zone).toBe("field");
    expect(bobSourceAfterConfirm.exhaustState).toBe("exhausted");
  });
});

describe("BSDB01-C09: battle_destroy_cost_gate の getLegalActions/applyLegalAction 経路 (GUI/REST 実行経路)", () => {
  function destroyCostGateCE(gatedPlayerId: string): ContinuousEffect {
    return {
      effectId: "ce-battle-destroy-cost-gate-legal-action-test",
      sourceInstanceId: "c09-magic",
      sourceDefinitionId: C09.cardNo,
      actingPlayerId: gatedPlayerId === "bob" ? "alice" : "bob",
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "battle_destroy_cost_gate_both",
      targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
      metadata: { costTargetCategory: ["spirit", "ultimate"] },
    };
  }

  it("getLegalActions が battleDestroyCostSourceInstanceId 付きの attack 選択肢を列挙し、applyLegalAction で実行すると破壊コストが支払われる", () => {
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSource, bobOther],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...effectLookups,
    });
    const attackAction = legalActions.find(
      (a) =>
        a.kind === "attack" &&
        a.sourceInstanceId === "bob-source" &&
        a.battleDestroyCostSourceInstanceId === "bob-other"
    );
    expect(attackAction).toBeDefined();
    if (attackAction?.kind !== "attack") throw new Error("unreachable");
    expect(attackAction.battleDestroyCostSourceInstanceIds).toEqual([
      "bob-other",
    ]);

    const applied = applyLegalAction({
      state,
      action: attackAction,
      ...effectLookups,
    });
    const bobOtherAfterApply = applied.state.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterApply.zone).toBe("trash");
    expect(applied.state.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      sourceInstanceId: "bob-source",
      battleDestroyCostSourceInstanceId: "bob-other",
    });
  });

  it("getLegalActions が battleDestroyCostSourceInstanceId 付きの block 選択肢を列挙し、applyLegalAction で実行すると破壊コストが支払われる", () => {
    const attacker = createCardInstance(ALICE_ATTACKER, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobSource = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-source",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [attacker, bobSource, bobOther],
      step: "attack",
      window: "declare_attack",
      activePlayerId: "alice",
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:alice-attacker",
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
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      activeContinuousEffects: [destroyCostGateCE("bob")],
    };

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...effectLookups,
    });
    const blockAction = legalActions.find(
      (a) =>
        a.kind === "block" &&
        a.sourceInstanceId === "bob-source" &&
        a.battleDestroyCostSourceInstanceId === "bob-other"
    );
    expect(blockAction).toBeDefined();
    if (blockAction?.kind !== "block") throw new Error("unreachable");

    const applied = applyLegalAction({
      state,
      action: blockAction,
      ...effectLookups,
    });
    const bobOtherAfterApply = applied.state.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterApply.zone).toBe("trash");
  });
});

describe("battle_destroy_cost_gate: 途中合流アタック (join_active_attack, P3-115) 経路もゲート対象になる", () => {
  function destroyCostGateCE(gatedPlayerId: string): ContinuousEffect {
    return {
      effectId: "ce-battle-destroy-cost-gate-join-test",
      sourceInstanceId: "c09-magic",
      sourceDefinitionId: C09.cardNo,
      actingPlayerId: gatedPlayerId === "bob" ? "alice" : "bob",
      duration: { scope: "battle" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "battle_destroy_cost_gate_both",
      targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
      metadata: { costTargetCategory: ["spirit", "ultimate"] },
    };
  }
  function midBattleJoinGrantCE(playerId: string): ContinuousEffect {
    return {
      effectId: "ce-mid-battle-join-grant-test",
      sourceInstanceId: "grant-source",
      sourceDefinitionId: "test-def",
      actingPlayerId: playerId,
      duration: { scope: "step" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "allow_mid_battle_join",
      targetInstanceId: playerId,
      metadata: { filter: { category: ["spirit", "ultimate"] } },
    };
  }

  function buildJoinScenarioState(): GameState {
    const bobPrimary = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-primary",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      exhaustState: "exhausted",
    });
    const bobJoiner = createCardInstance(BOB_SOURCE, {
      instanceId: "bob-joiner",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const bobOther = createCardInstance(BOB_OTHER, {
      instanceId: "bob-other",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    return {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobPrimary, bobJoiner, bobOther],
      step: "attack",
      window: "declare_attack",
      activePlayerId: "bob",
      summonedDuringAttackStepInstanceIds: ["bob-joiner"],
      pendingImmediateAttackJoins: [
        {
          attackId: "attack-group:1:bob:battle-entity:bob-primary",
          sourceInstanceId: "bob-joiner",
        },
      ],
      activeAttack: {
        attackId: "attack-group:1:bob:battle-entity:bob-primary",
        primaryEntityId: "battle-entity:bob-primary",
        participantEntityIds: ["battle-entity:bob-primary"],
        groupMode: "single",
        target: { kind: "player", playerId: "alice" },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:bob-primary",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
      activeContinuousEffects: [
        destroyCostGateCE("bob"),
        midBattleJoinGrantCE("bob"),
      ],
    };
  }

  it("破壊候補は bob-joiner 自身を除く同じ controller の全カード (既にアタック中の bob-primary も含む)", () => {
    const state = buildJoinScenarioState();
    // bob-other を除去しても、既にアタック中の bob-primary 自身が破壊コスト候補として
    // 残る (join_active_attack の対象は bob-joiner 自身のみ除外される)。
    const stateWithoutOther: GameState = {
      ...state,
      cardInstances: state.cardInstances.filter(
        (c) => c.instanceId !== "bob-other"
      ),
    };
    const legalActions = getLegalActions({
      state: stateWithoutOther,
      actingPlayerId: "bob",
      ...effectLookups,
    });
    const joinAction = legalActions.find(
      (a) =>
        a.kind === "join_active_attack" && a.sourceInstanceId === "bob-joiner"
    );
    expect(joinAction).toBeDefined();
    if (joinAction?.kind !== "join_active_attack") {
      throw new Error("unreachable");
    }
    expect(joinAction.battleDestroyCostSourceInstanceId).toBe("bob-primary");
  });

  it("getLegalActions が battleDestroyCostSourceInstanceId 付きの join_active_attack を列挙し、applyLegalAction → pass で合流が確定し破壊コストも支払われる", () => {
    const state = buildJoinScenarioState();

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      ...effectLookups,
    });
    const joinAction = legalActions.find(
      (a) =>
        a.kind === "join_active_attack" &&
        a.sourceInstanceId === "bob-joiner" &&
        a.battleDestroyCostSourceInstanceId === "bob-other"
    );
    expect(joinAction).toBeDefined();
    if (joinAction?.kind !== "join_active_attack") {
      throw new Error("unreachable");
    }

    const declared = applyLegalAction({
      state,
      action: joinAction,
      ...effectLookups,
    });
    // 破壊コストは宣言時 (pre_declaration_stack window を開く前) に即実行される。
    const bobOtherAfterDeclare = declared.state.cardInstances.find(
      (c) => c.instanceId === "bob-other"
    )!;
    expect(bobOtherAfterDeclare.zone).toBe("trash");

    const afterPass = usePassPreDeclarationStackAsAction({
      state: declared.state,
      actingPlayerId: "alice",
    });
    const result = confirmJoinActiveAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getCardDefinitionByIdWithSpirits }
    );
    expect(result.entityId).not.toBe("");
    expect(result.state.activeAttack?.participantEntityIds).toContain(
      "battle-entity:bob-joiner"
    );
  });
});
