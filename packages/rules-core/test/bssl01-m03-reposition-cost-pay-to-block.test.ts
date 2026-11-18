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
import { finalizeBattleEndScopeExpirations } from "../src/battle/battle-end-scope-finalize";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type {
  BattleEntity,
  CardDefinition,
  EffectUsageLimit,
  GameState,
} from "../src";
import {
  canUseEffectUsage,
  listEffectUsage,
  pruneExpiredEffectUsageForTest,
  seedEffectUsage,
} from "./helpers/effect-usage-fixture";

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
const getCardDefinitionById = (id: string) =>
  cardNoMap.get(id) ?? (id === SUISHO.cardNo ? SUISHO : undefined);

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
    const goku = cardNoMap.get("BSDB01-C01")!;
    const piccolo = cardNoMap.get("BSDB01-M02")!;
    const bobSpirit = createCardInstance(goku, {
      instanceId: "bob-spirit",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const responder = createCardInstance(piccolo, {
      instanceId: "piccolo",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "hand",
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
        cardInstances: [kaisel, suisho, bobSpirit, responder],
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
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup([
        piccolo,
      ]),
    });

    expect(after.pendingTargetedDisclosureContinuation).toBeNull();
    expect(after.pendingPrivateDeclarations).toHaveLength(0);
    expect(after.pendingTriggeredEffects).not.toContainEqual(
      expect.objectContaining({ eventKind: "targeted" })
    );
    expect(M03.textLines[4]).toContain("相手は、ブロックする");

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

/** 〔バトルに1回:同名〕。発揮元個体は state に置かないため、定義と使用者を明示する。 */
const BATTLE_LIMIT: EffectUsageLimit = {
  kind: "per_card_name",
  duration: "battle",
};

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
    const withRecord: GameState = seedEffectUsage(inBattle, {
      sourceInstanceId: "kaisel",
      sourceDefinitionId: "BSSL01-M03",
      playerId: "alice",
      effectLabel: "flash-3-4",
      usageLimit: BATTLE_LIMIT,
    });
    const recorded = listEffectUsage(withRecord);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      period: "battle",
      periodId: "battle:attack-1",
      nameKey: M03.name,
    });
    expect(
      listEffectUsage(pruneExpiredEffectUsageForTest(withRecord))
    ).toHaveLength(1);
  });

  it("バトル終了の確定で、そのバトルの記録は整理される (同じ attackId の次のバトルへ持ち越さない)", () => {
    const attackOf = (attackId: string) => ({
      attackId,
      primaryEntityId: "be-x",
      participantEntityIds: ["be-x"],
      groupMode: "single" as const,
      target: { kind: "player" as const, playerId: "bob" },
      blockAssignments: [],
      symbolResolutionOrder: [],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    });
    const inBattle = createEmptyGameState({
      playerIds: ["alice", "bob"],
      activeAttack: attackOf("attack-1"),
    });
    const options = {
      sourceInstanceId: "kaisel",
      sourceDefinitionId: "BSSL01-M03",
      playerId: "alice",
      effectLabel: "flash-3-4",
      usageLimit: BATTLE_LIMIT,
    };
    const used = seedEffectUsage(inBattle, options);
    expect(canUseEffectUsage(used, options)).toBe(false);
    // バトル解決後 (activeAttack は null) に確定処理が走る。
    const ended = finalizeBattleEndScopeExpirations(
      { ...used, activeAttack: null },
      "attack-1"
    );
    expect(listEffectUsage(ended)).toHaveLength(0);
    // 同じ攻撃者が同じステップで再度アタックしても attackId は同じ。新しいバトルとして使用できる。
    const again: GameState = { ...ended, activeAttack: attackOf("attack-1") };
    expect(canUseEffectUsage(again, options)).toBe(true);
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
    const recorded: GameState = seedEffectUsage(battle1, {
      sourceInstanceId: "kaisel",
      sourceDefinitionId: "BSSL01-M03",
      playerId: "alice",
      effectLabel: "flash-3-4",
      usageLimit: BATTLE_LIMIT,
    });
    expect(listEffectUsage(recorded)).toHaveLength(1);

    const battle2: GameState = {
      ...recorded,
      activeAttack: { ...recorded.activeAttack!, attackId: "attack-2" },
    };
    expect(
      listEffectUsage(pruneExpiredEffectUsageForTest(battle2))
    ).toHaveLength(0);

    const outOfBattle: GameState = { ...recorded, activeAttack: null };
    expect(
      listEffectUsage(pruneExpiredEffectUsageForTest(outOfBattle))
    ).toHaveLength(0);
  });
});
