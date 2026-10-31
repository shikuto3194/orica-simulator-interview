/**
 * BSSL01-M03「カイセル」effects[3,4]:
 *   Lv1-Lv2 フラッシュ『自分のアタックステップ』〔バトルに1回:同名〕このスピリットを自分の
 *   アタックしている「水篠 旬」と同じ状態で右隣に並べることで、このバトルの間、相手はブロック
 *   するスピリットのコア1個をトラッシュに置かなければブロックできない。
 *
 * 状態合わせと右隣への配置を完了した場合だけ、conditional_cost でブロック対価を課す。
 * pay-to-block ゲートは BSAZ01-C09 と同型の require_battle_cost を流用し、
 * 〔バトルに1回:同名〕は今回新設した EffectUsageLimitDuration "battle" (state.activeAttack.attackId
 * スコープ) で表現する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  clearExpiredEffectUsageRecords,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  recordEffectUsage,
} from "../src";
import type { BattleEntity, CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const M03 = cardNoMap.get("BSSL01-M03")!;

const SUISHO: CardDefinition = {
  cardNo: "TEST-M03-SUISHO",
  name: "水篠 旬",
  printedCategory: "spirit",
  colors: ["purple"],
  cost: 2,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["purple"],
  textLines: [],
  keywordTags: [],
  tribe: "影",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};
const BOB_SPIRIT: CardDefinition = {
  cardNo: "TEST-M03-BOB-SPIRIT",
  name: "test bob spirit",
  printedCategory: "spirit",
  colors: ["blue"],
  cost: 1,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
  symbolColors: ["blue"],
  textLines: [],
  keywordTags: [],
  tribe: "水星",
  sourceUrls: [],
  sourceConfidence: "C",
  effects: [],
};

const testCardMap = new Map<string, CardDefinition>([
  [SUISHO.cardNo, SUISHO],
  [BOB_SPIRIT.cardNo, BOB_SPIRIT],
]);
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? testCardMap.get(id);

function findFlashEffect(def: CardDefinition) {
  return def.effects!.find(
    (e) =>
      e.timing.kind === "activated" &&
      (e.timing as { mode?: string }).mode === "flash"
  )!;
}

describe("BSSL01-M03 effects[3,4]: 再配置コスト(状態コピー) + pay-to-block ゲート", () => {
  it("effect 定義: 自分の攻撃中「水篠 旬」条件 + set_exhaust_state(matchExhaustStateOf)/require_battle_cost の2 step + usageLimit battle duration", () => {
    const effect = findFlashEffect(M03);
    expect(effect).toBeDefined();
    expect(effect.stub).toBeUndefined();
    expect(effect.timingScope).toEqual({ player: "self", period: "attack" });
    expect(effect.usageLimit).toEqual({
      kind: "per_card_name",
      duration: "battle",
    });
    expect(effect.condition).toEqual([
      {
        kind: "field_has",
        player: "self",
        category: ["spirit"],
        cardNames: [{ contains: "水篠 旬" }],
        battleState: "attacking",
      },
    ]);
    expect(effect.steps).toHaveLength(2);

    const syncAction = effect.steps[0]!.action;
    expect(syncAction.kind).toBe("set_exhaust_state");
    if (syncAction.kind !== "set_exhaust_state") throw new Error("unreachable");
    expect(syncAction.target).toEqual({ kind: "self" });
    expect(syncAction.matchExhaustStateOf).toEqual({
      kind: "filter",
      player: "self",
      filter: {
        category: ["spirit"],
        cardName: { contains: "水篠 旬" },
        battleState: "attacking",
      },
      count: 1,
    });

    const gateAction = effect.steps[1]!.action;
    expect(gateAction.kind).toBe("require_battle_cost");
    if (gateAction.kind !== "require_battle_cost")
      throw new Error("unreachable");
    expect(gateAction.target).toEqual({
      kind: "filter",
      player: "opponent",
      filter: { category: ["spirit"] },
      count: "all",
    });
    expect(gateAction.restriction).toEqual(["block"]);
    expect(gateAction.costAmount).toBe(1);
    expect(gateAction.duration).toEqual({ scope: "battle" });
  });

  it("実行すると自分の疲労状態がアタック中『水篠 旬』と同期し、battle_cost_gate_block CE がこのバトルの attackId スコープで付与される", () => {
    const kaisel = createCardInstance(M03, {
      instanceId: "kaisel",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      exhaustState: "recovered",
    });
    const suisho = createCardInstance(SUISHO, {
      instanceId: "suisho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      exhaustState: "exhausted",
    });
    const bobSpirit = createCardInstance(BOB_SPIRIT, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
    });
    const battleEntities: BattleEntity[] = [
      {
        entityId: "be-suisho",
        memberInstanceIds: ["suisho"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ];
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [kaisel, suisho, bobSpirit],
        battleEntities,
        activeAttack: {
          attackId: "attack-1",
          primaryEntityId: "be-suisho",
          participantEntityIds: ["be-suisho"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            { participantEntityId: "be-suisho", blockedByEntityIds: [] },
          ],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
      }),
      step: "attack",
    };

    const effect = findFlashEffect(M03);
    const after = executeEffect({
      chainId: "test:bssl01-m03-reposition-cost-pay-to-block:181",
      state,
      effect,
      sourceInstanceId: "kaisel",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const kaiselAfter = after.cardInstances.find(
      (c) => c.instanceId === "kaisel"
    )!;
    expect(kaiselAfter.exhaustState).toBe("exhausted");

    const gateCEs = after.activeContinuousEffects.filter(
      (ce) => ce.modifierTag === "battle_cost_gate_block"
    );
    expect(gateCEs).toHaveLength(1);
    expect(gateCEs[0]!.targetFilter).toEqual({
      player: "opponent",
      category: ["spirit"],
    });
    expect(gateCEs[0]!.metadata).toEqual({ costAmount: 1 });
    expect(gateCEs[0]!.duration).toEqual({ scope: "battle" });
    expect(gateCEs[0]!.createdAtAttackId).toBe("attack-1");
  });

  it("参照カードが『回復』状態なら自分も『回復』状態に同期する (matchExhaustStateOf は exhausted 固定近似ではない)", () => {
    const kaisel = createCardInstance(M03, {
      instanceId: "kaisel",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      exhaustState: "exhausted",
    });
    const suisho = createCardInstance(SUISHO, {
      instanceId: "suisho",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      exhaustState: "recovered",
    });
    const battleEntities: BattleEntity[] = [
      {
        entityId: "be-suisho",
        memberInstanceIds: ["suisho"],
        resolvedBp: 3000,
        resolvedSymbols: ["purple"],
        attackState: "attacking",
      },
    ];
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [kaisel, suisho],
        battleEntities,
        activeAttack: {
          attackId: "attack-1",
          primaryEntityId: "be-suisho",
          participantEntityIds: ["be-suisho"],
          groupMode: "single",
          target: { kind: "player", playerId: "bob" },
          blockAssignments: [
            { participantEntityId: "be-suisho", blockedByEntityIds: [] },
          ],
          symbolResolutionOrder: [],
          flashBeforeBlockCompleted: false,
          flashAfterBlockCompleted: false,
          flashWindowState: null,
        },
      }),
      step: "attack",
    };

    const effect = findFlashEffect(M03);
    const after = executeEffect({
      chainId: "test:bssl01-m03-reposition-cost-pay-to-block:255",
      state,
      effect,
      sourceInstanceId: "kaisel",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });

    const kaiselAfter = after.cardInstances.find(
      (c) => c.instanceId === "kaisel"
    )!;
    expect(kaiselAfter.exhaustState).toBe("recovered");
  });
});

describe("EffectUsageLimitDuration 'battle' (BSSL01-M03[3,4] 新設): attackId スコープの記録/失効", () => {
  it("同一バトル (同一 attackId) の間は記録が有効期間内に留まる", () => {
    const inBattle = createEmptyGameState({
      playerIds: ["alice", "bob"],
      activeAttack: {
        attackId: "attack-1",
        primaryEntityId: "be-x",
        participantEntityIds: ["be-x"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    });
    const withRecord: GameState = {
      ...inBattle,
      effectUsageRecords: recordEffectUsage({
        state: inBattle,
        sourceInstanceId: "kaisel",
        sourceDefinitionId: "BSSL01-M03",
        effectLabel: "flash-3-4",
        duration: "battle",
      }),
    };
    expect(withRecord.effectUsageRecords[0]?.attackId).toBe("attack-1");
    expect(clearExpiredEffectUsageRecords(withRecord)).toHaveLength(1);
  });

  it("バトルが変わる (attackId が変化する) と記録は失効し除去される", () => {
    const battle1 = createEmptyGameState({
      playerIds: ["alice", "bob"],
      activeAttack: {
        attackId: "attack-1",
        primaryEntityId: "be-x",
        participantEntityIds: ["be-x"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [],
        symbolResolutionOrder: [],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    });
    const recorded: GameState = {
      ...battle1,
      effectUsageRecords: recordEffectUsage({
        state: battle1,
        sourceInstanceId: "kaisel",
        sourceDefinitionId: "BSSL01-M03",
        effectLabel: "flash-3-4",
        duration: "battle",
      }),
    };

    const battle2: GameState = {
      ...recorded,
      activeAttack: { ...recorded.activeAttack!, attackId: "attack-2" },
    };
    expect(clearExpiredEffectUsageRecords(battle2)).toHaveLength(0);

    const outOfBattle: GameState = { ...recorded, activeAttack: null };
    expect(clearExpiredEffectUsageRecords(outOfBattle)).toHaveLength(0);
  });
});
