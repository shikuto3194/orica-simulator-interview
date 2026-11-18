/**
 * BSTH02.7-C06 試験中「レベルティターニア」effects[1] フラッシュ二択 branch1 の検証。
 *
 * 原文 (textLines[2,3] 抜粋):
 * "フラッシュ
 *  相手のスピリット/アルティメット2体を指定し、このターンの間、自分のライフは
 *  指定した対象によって減らない。または、〔ゲームに1回:同名〕手札/手元にある
 *  系統：「幻想」/「動玩」を持つコスト7以下のスピリットカード2枚までを軽減シンボル
 *  すべてを満たして召喚できる。このとき、トラッシュにある黄1色のカード8枚までを
 *  除外することで、除外したカード4枚につき、召喚するスピリットカード1枚のコストを
 *  0にする。"
 *
 * このイテレーションでは branch1 (相手2体指定でライフ減少防止) のみ実装する。
 * BSSG01-C06 effects[2] (life_damage_interception replace + attackerSelectedTarget
 * count:1) と同型、target.count のみ 2 に拡張した trivial reuse
 * (packages/rules-core/test/attacker-filtered-life-prevention.test.ts の
 * BSSG01-C06 テストと同じ検証パターン)。branch2 (幻想/動玩コスト7以下2枚まで召喚 +
 * トラッシュ除外コスト0化) は cost_modify 新規 grouping primitive 待ちのため
 * effect.stub に未実装として明記済み。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  BattleEntity,
  BattleResolutionGroup,
  CardDefinition,
  GameState,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import { getUnblockedLifeDamage } from "../src/battle/battle-actions";
import { expandCardDefinitionsWithBackFaces } from "../src/effect/structured-effect-registrations";

const cardNoMap = new Map<string, CardDefinition>(
  expandCardDefinitionsWithBackFaces(ALL_CARDS).map((c) => [c.cardNo, c])
);
const card = (no: string): CardDefinition => {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
};
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);

const ALICE = "player-1";
const BOB = "player-2";

function withBattle(
  state: GameState,
  attackers: { entityId: string; leaderId: string }[],
  targetPlayerId: string
): GameState {
  const battleEntities: BattleEntity[] = attackers.map((a) => ({
    entityId: a.entityId,
    memberInstanceIds: [a.leaderId],
    resolvedBp: 5000,
    resolvedSymbols: ["red"],
    attackState: "attacking",
  }));
  const group: BattleResolutionGroup = {
    attackId: "atk-1",
    groupMode: "single",
    target: { kind: "player", playerId: targetPlayerId },
    symbolResolutionOrder: attackers.map((a) => a.entityId),
    participantSnapshots: attackers.map((a) => ({
      entityId: a.entityId,
      memberInstanceIds: [a.leaderId],
      resolvedBp: 5000,
      resolvedSymbols: ["red"],
      blockedBy: [],
    })),
  };
  return { ...state, battleEntities, battleResolutionGroup: group };
}

describe("BSTH02.7-C06 試験中「レベルティターニア」フラッシュ branch1", () => {
  it("effects[1]: life_damage_interception(replace) + attackerSelectedTarget + target.count:2", () => {
    const c = card("BSTH02.7-C06");
    const eff = c.effects![1]!;
    expect(eff.timing).toEqual({ kind: "activated", mode: "flash" });
    expect(eff.executionMode).toBe("optional");
    expect(eff.stub).toBeUndefined();
    const action = eff.steps[0]!.action;
    expect(action.kind).toBe("life_damage_interception");
    if (action.kind === "life_damage_interception") {
      expect(action.mode).toBe("replace");
      expect(action.player).toBe("self");
      expect(action.cause).toBe("any");
      expect(action.attackerSelectedTarget).toBe(true);
      expect(action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 2,
      });
      expect(action.duration).toEqual({ scope: "turn" });
    }
  });

  it("[board] 指定した相手2体のアタックはライフ減少0、未指定の3体目は通る", () => {
    const c = card("BSTH02.7-C06");
    const magic = createCardInstance(c, {
      instanceId: "th027-c06",
      ownerPlayerId: ALICE,
      zone: "field",
    });
    const chosen1 = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-chosen-1",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const chosen2 = createCardInstance(card("BSSA01-C01"), {
      instanceId: "atk-chosen-2",
      ownerPlayerId: BOB,
      zone: "field",
    });
    const other = createCardInstance(card("BSSA01-C04"), {
      instanceId: "atk-other",
      ownerPlayerId: BOB,
      zone: "field",
    });
    let state = createEmptyGameState({
      cardInstances: [magic, chosen1, chosen2, other],
      playerOverrides: [
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
        { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
      ],
    });

    // スタック解決時に対象2体 (chosen1, chosen2) が選ばれた前提で executeEffect に注入。
    state = executeEffect({
      chainId: "test:bsth02-7-c06-flash-life-prevention:130",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "th027-c06",
      actingPlayerId: ALICE,
      getCardDefinitionById: getDef,
      getRegisteredTriggeredEffectActions: () => [],
      targetInstanceIds: ["atk-chosen-1", "atk-chosen-2"],
    });
    const ce = state.activeContinuousEffects.find(
      (e) => e.modifierTag === "life_damage_interception"
    );
    expect(ce).toBeDefined();
    expect(
      (ce!.metadata as { attackerInstanceIds?: string[] }).attackerInstanceIds
    ).toEqual(["atk-chosen-1", "atk-chosen-2"]);

    // 3 体同時アタック (chosen1 + chosen2 + other) → ALICE 防御。
    const battleState = withBattle(
      state,
      [
        { entityId: "e-chosen-1", leaderId: "atk-chosen-1" },
        { entityId: "e-chosen-2", leaderId: "atk-chosen-2" },
        { entityId: "e-other", leaderId: "atk-other" },
      ],
      ALICE
    );
    const dmg = getUnblockedLifeDamage(battleState, getDef);
    // 指定した2体は防止、未指定 other のみ 1 ダメージ。
    expect(dmg!.totalLifeDamage).toBe(1);
  });
});
