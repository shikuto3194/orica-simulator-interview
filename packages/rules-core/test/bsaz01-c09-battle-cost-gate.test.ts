/** 作戦の常時使用許可と、通常マジック使用で発揮する本文の検証。 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  generateFieldCardEffectRegistrations,
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
  useAttackAsAction,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const C09 = cardNoMap.get("BSAZ01-C09")!;

function makeSpirit(cardNo: string, tribe: string): CardDefinition {
  return {
    cardNo,
    name: `test ${cardNo}`,
    printedCategory: "spirit",
    colors: ["yellow"],
    cost: 1,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["yellow"],
    textLines: [],
    keywordTags: [],
    tribe,
    sourceUrls: [],
    sourceConfidence: "C",
    effects: [],
  };
}
const EARTH_CF_SPIRIT = makeSpirit("TEST-C09-EARTH-CF", "地球・ＣＦ");
const PLAIN_SPIRIT_A = makeSpirit("TEST-C09-PLAIN-A", "火星");
const PLAIN_SPIRIT_B = makeSpirit("TEST-C09-PLAIN-B", "火星");

const testCardMap = new Map<string, CardDefinition>([
  [EARTH_CF_SPIRIT.cardNo, EARTH_CF_SPIRIT],
  [PLAIN_SPIRIT_A.cardNo, PLAIN_SPIRIT_A],
  [PLAIN_SPIRIT_B.cardNo, PLAIN_SPIRIT_B],
]);
const getCardDefinitionByIdWithSpirits = (id: string) =>
  cardNoMap.get(id) ?? testCardMap.get(id);

function findFieldEffect(def: CardDefinition) {
  return def.effects!.find(
    (e) =>
      e.timing.kind === "activated" &&
      e.timing.mode === "stack" &&
      e.steps.some((s) => s.action.kind === "require_battle_cost")
  )!;
}

describe("BSAZ01-C09 effects[2]: フィールド常駐スタック (require_battle_cost 新設)", () => {
  it("effect 定義: applicability.zone:field + timingScope both/attack + field_has 条件 + require_battle_cost/block_unblockable の2 step", () => {
    const effect = findFieldEffect(C09);
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.applicability).toBeUndefined();
    expect(effect.timing).toEqual({ kind: "activated", mode: "stack" });

    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["spirit"],
        tribesRequired: ["地球", "ＣＦ"],
      },
    ]);
    expect(effect.steps).toHaveLength(2);

    const costAction = effect.steps[0]!.action;
    expect(costAction.kind).toBe("require_battle_cost");
    if (costAction.kind !== "require_battle_cost")
      throw new Error("unreachable");
    expect(costAction.target).toEqual({
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit", "ultimate"] },
      count: "all",
    });
    expect(costAction.restriction).toEqual(["attack", "block"]);
    expect(costAction.costAmount).toBe(1);
    expect(costAction.duration).toEqual({ scope: "turn" });

    const unblockableAction = effect.steps[1]!.action;
    expect(unblockableAction.kind).toBe("block_unblockable");
  });

  it("使用許可を無償のフィールド起動効果として登録しない", () => {
    expect(generateFieldCardEffectRegistrations(C09)).toHaveLength(0);
  });

  it("実行すると battle_cost_gate_both CE (metadata.costAmount) + 双方の block_unblockable CE が付与される", () => {
    const c09Field = createCardInstance(C09, {
      instanceId: "c09-field",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const aliceEarthCf = createCardInstance(EARTH_CF_SPIRIT, {
      instanceId: "alice-earth-cf",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const aliceSpirit = createCardInstance(PLAIN_SPIRIT_A, {
      instanceId: "alice-spirit",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const bobSpirit = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [c09Field, aliceEarthCf, aliceSpirit, bobSpirit],
    });
    const effect = findFieldEffect(C09);
    const after = executeEffect({
      chainId: "test:bsaz01-c09-battle-cost-gate:164",
      state,
      effect,
      sourceInstanceId: "c09-field",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });

    const costGateCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "battle_cost_gate_both"
    );
    expect(costGateCEs).toHaveLength(1);
    expect(costGateCEs[0]!.targetFilter).toEqual({
      player: "opponent",
      category: ["spirit", "ultimate"],
    });
    expect(costGateCEs[0]!.metadata).toEqual({ costAmount: 1 });
    expect(costGateCEs[0]!.duration).toEqual({ scope: "turn" });

    const blockUnblockableCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "block_unblockable"
    );
    const targetedInstanceIds = blockUnblockableCEs
      .map((ce) => ce.targetInstanceId)
      .sort();
    expect(targetedInstanceIds).toEqual(
      ["alice-earth-cf", "alice-spirit", "bob-spirit"].sort()
    );
  });
});

describe("BSAZ01-C09: battle_cost_gate によるアタック/ブロック宣言ゲート", () => {
  function costGateCE(gatedPlayerId: string): ContinuousEffect {
    return {
      effectId: "ce-battle-cost-gate-test",
      sourceInstanceId: "c09-field",
      sourceDefinitionId: C09.cardNo,
      actingPlayerId: gatedPlayerId === "bob" ? "alice" : "bob",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "battle_cost_gate_both",
      targetFilter: { player: "opponent", category: ["spirit", "ultimate"] },
      metadata: { costAmount: 1 },
    };
  }

  it("対象カードの通常コアが0個ならアタック宣言不可 (source_not_ready)", () => {
    const bobSpirit = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSpirit],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [costGateCE("bob")],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-spirit",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBe("source_not_ready");
  });

  it("「効果を受けない」(defense_immune) スピリットはコアがあってもアタック宣言不可 (source_not_ready): コスト支払いは対象への効果として耐性の対象になる (needs-ruling.jsonl BSAZ01-C09, 2026-08-05 ユーザー確認)", () => {
    const bobSpirit = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 3,
    });
    const immunityCe: ContinuousEffect = {
      effectId: "ce-effect-immunity-bob-spirit",
      sourceInstanceId: "bob-spirit",
      sourceDefinitionId: PLAIN_SPIRIT_B.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "defense_immune",
      targetInstanceId: "bob-spirit",
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSpirit],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [costGateCE("bob"), immunityCe],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-spirit",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBe("source_not_ready");
  });

  it("「コアが1個より少なくならない」(cannot_reduce_cores_below coreMinimum:1) 保護スピリットはコア1個ではアタック宣言不可 (source_not_ready)", () => {
    const bobSpirit = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const coreFloorCe: ContinuousEffect = {
      effectId: "ce-core-floor-bob-spirit",
      sourceInstanceId: "bob-spirit",
      sourceDefinitionId: PLAIN_SPIRIT_B.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_reduce_cores_below",
      targetInstanceId: "bob-spirit",
      metadata: { coreMinimum: 1 },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSpirit],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [costGateCE("bob"), coreFloorCe],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-spirit",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBe("source_not_ready");
  });

  it("「コアが1個より少なくならない」保護でもコアが2個あれば1個を支払えるためアタック宣言可能", () => {
    const bobSpirit = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 2,
    });
    const coreFloorCe: ContinuousEffect = {
      effectId: "ce-core-floor-bob-spirit-2",
      sourceInstanceId: "bob-spirit",
      sourceDefinitionId: PLAIN_SPIRIT_B.cardNo,
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "cannot_reduce_cores_below",
      targetInstanceId: "bob-spirit",
      metadata: { coreMinimum: 1 },
    };
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSpirit],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [costGateCE("bob"), coreFloorCe],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-spirit",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBeNull();
  });

  it("対象カードの通常コアが1個以上ならアタック宣言可能、確定するとコアが1個トラッシュへ支払われる", () => {
    const bobSpirit = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [bobSpirit],
      step: "attack",
      window: "none",
      activePlayerId: "bob",
      activeContinuousEffects: [costGateCE("bob")],
    };
    const reason = getAttackDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-spirit",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBeNull();

    const tentative = useAttackAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-spirit",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "alice",
    });
    const result = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getCardDefinitionByIdWithSpirits }
    );

    const bobSpiritAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "bob-spirit"
    )!;
    expect(bobSpiritAfter.normalCoreCount).toBe(0);
    const bobPlayer = result.state.players.find((p) => p.id === "bob")!;
    expect(bobPlayer.trashNormalCoreCount).toBe(1);
  });

  it("対象カードの通常コアが0個ならブロック宣言不可 (source_not_ready)", () => {
    const attacker = createCardInstance(PLAIN_SPIRIT_A, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const blocker = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [attacker, blocker],
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
      activeContinuousEffects: [costGateCE("bob")],
    };
    const reason = getBlockDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-blocker",
      participantEntityId: "battle-entity:alice-attacker",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBe("source_not_ready");
  });

  it("対象カードの通常コアが1個以上ならブロック宣言可能、確定するとコアが1個トラッシュへ支払われる", () => {
    const attacker = createCardInstance(PLAIN_SPIRIT_A, {
      instanceId: "alice-attacker",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
    });
    const blocker = createCardInstance(PLAIN_SPIRIT_B, {
      instanceId: "bob-blocker",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [attacker, blocker],
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
      activeContinuousEffects: [costGateCE("bob")],
    };
    const reason = getBlockDeclarationBlockReason({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-blocker",
      participantEntityId: "battle-entity:alice-attacker",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
    });
    expect(reason).toBeNull();

    const tentative = useBlockAsAction({
      state,
      actingPlayerId: "bob",
      sourceInstanceId: "bob-blocker",
      participantEntityId: "battle-entity:alice-attacker",
      getCardDefinitionById: getCardDefinitionByIdWithSpirits,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentative,
      actingPlayerId: "alice",
    });
    const result = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: getCardDefinitionByIdWithSpirits }
    );

    const blockerAfter = result.state.cardInstances.find(
      (c) => c.instanceId === "bob-blocker"
    )!;
    expect(blockerAfter.normalCoreCount).toBe(0);
    const bobPlayer = result.state.players.find((p) => p.id === "bob")!;
    expect(bobPlayer.trashNormalCoreCount).toBe(1);
  });
});
