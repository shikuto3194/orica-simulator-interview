/**
 * BSTH01-XX02 博麗 霊夢 effects[1] 【解放：Lv4】『このスピリットのアタック時』検証。
 *
 * 原文 (textLines[6,7]):
 *   "【解放：Lv4】Lv2-Lv3『このスピリットのアタック時』"
 *   "このスピリットがLv4になるように自分の赤の導界者ネクサスのコアを置くことで、
 *    相手のスピリット/アルティメット1体を破壊する。この効果の破壊によって相手の一切の効果は
 *    発揮されない。"
 *
 * 旧 stub は amount を固定 1 で近似していた（本来は「Lv4になるように」= 動的
 * Lv4維持コア数(6) − 現在のコア数）。target-resolution.ts の resolveSourceCount
 * "cores_on" 分岐に this_card/target_card/ref のステップ文脈解決を追加し、
 * `{ source: cores_on(this_card), multiplier:0, offset:6, subtract: cores_on(this_card) }`
 * で正確な動的 amount = max(0, 6 - 現在コア数) を表現できるようにした
 * (ENGINE-cores-on-step-context-location: needs-dsl READY stub 解消)。
 *
 * 検証ポイント (shape):
 *   - step0 = core_move from field_card (self red 導界者ネクサス, targetsGrandwalker) →
 *             this_card, amount = DynamicCount (offset:6 / subtract:cores_on(this_card))
 *   - step1 = destroy opponent spirit/ultimate ×1, suppressDestroyedEffects:"all_opponent",
 *             connector:conditional_cost
 *   - effects[1] はもう stub フィールドを持たない (fidelity 解消)
 *
 * 挙動 (happy path):
 *   - Lv2 (cores=2) + 赤導界者ネクサス 4 コア → amount=6-2=4 を全額支払い可能
 *     → 自カードのコアが 2→6、ネクサスのコアが 4→0、相手スピリットが破壊される
 *   - Lv3 (cores=3) + 赤導界者ネクサス 3 コア → amount=6-3=3 を全額支払い可能
 *     → 自カードのコアが 3→6、ネクサスのコアが 3→0、相手スピリットが破壊される
 *
 * 挙動 (fail-closed):
 *   - Lv2 (cores=2) + 赤導界者ネクサス 2 コア (amount=4 に不足) → conditional_cost で
 *     全額支払い不能 → コア移動なし (rollback) → destroy 不発火
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH01-XX02 博麗 霊夢 effects[1] 【解放：Lv4】アタック時 動的コア配置+破壊", () => {
  const c = cardNoMap.get("BSTH01-XX02")!;
  const guideNexus = cardNoMap.get("BSTH01-XX01")!; // 赤含む導界者ネクサス「[導界者]八雲 紫」
  const opponentSpirit = cardNoMap.get("BSTH02-C01")!; // 任意のスピリット

  // ========== shape 検証 ==========
  it("effects[1] は stub フィールドを持たない (fidelity 解消済み)", () => {
    const e = c.effects![1]!;
    expect(e.stub).toBeUndefined();
  });

  it("step0 = core_move from field_card self red 導界者ネクサス → this_card, amount = 動的(6 - 現在コア数)", () => {
    const e = c.effects![1]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("core_move");
    if (step0.action.kind === "core_move") {
      expect(step0.action.from).toEqual({
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          colors: ["red"],
          tribes: ["導界者"],
          targetsGrandwalker: true,
        },
      });
      expect(step0.action.to).toEqual({ kind: "this_card" });
      expect(step0.action.amount).toEqual({
        source: { kind: "cores_on", location: { kind: "this_card" } },
        multiplier: 0,
        offset: 6,
        subtract: { kind: "cores_on", location: { kind: "this_card" } },
      });
    }
  });

  it("step1 = destroy opponent spirit/ultimate ×1, suppressDestroyedEffects:all_opponent, connector:conditional_cost", () => {
    const e = c.effects![1]!;
    const step1 = e.steps[1]!;
    expect(step1.action.kind).toBe("destroy");
    if (step1.action.kind === "destroy") {
      expect(step1.action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      });
      expect(step1.action.suppressDestroyedEffects).toBe("all_opponent");
    }
    expect(step1.connector).toBe("conditional_cost");
  });

  // ========== 挙動検証 ==========
  function setup(reimuCores: number, nexusCores: number) {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const reimu = createCardInstance(c, {
      instanceId: "reimu-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: reimuCores,
    });
    const nexus = createCardInstance(guideNexus, {
      instanceId: "nexus-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: nexusCores,
    });
    const enemy = createCardInstance(opponentSpirit, {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      cardInstances: [reimu, nexus, enemy],
    } as GameState;
  }

  it("Lv2 (cores=2) + ネクサス4コア: amount=6-2=4 を全額支払い → 自カード2→6, ネクサス4→0, 破壊成立", () => {
    const state = setup(2, 4);
    const result = executeEffect({
      chainId: "test:bsth01-xx02-attack-lv4-release:134",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "reimu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const reimu = result.cardInstances.find((x) => x.instanceId === "reimu-1")!;
    expect(reimu.normalCoreCount).toBe(6);
    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(0);
    const enemy = result.cardInstances.find((x) => x.instanceId === "enemy-1")!;
    expect(enemy.pendingLeaveKind === "destroy" || enemy.zone !== "field").toBe(
      true
    );
  });

  it("Lv3 (cores=3) + ネクサス3コア: amount=6-3=3 を全額支払い → 自カード3→6, ネクサス3→0, 破壊成立", () => {
    const state = setup(3, 3);
    const result = executeEffect({
      chainId: "test:bsth01-xx02-attack-lv4-release:153",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "reimu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const reimu = result.cardInstances.find((x) => x.instanceId === "reimu-1")!;
    expect(reimu.normalCoreCount).toBe(6);
    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(0);
    const enemy = result.cardInstances.find((x) => x.instanceId === "enemy-1")!;
    expect(enemy.pendingLeaveKind === "destroy" || enemy.zone !== "field").toBe(
      true
    );
  });

  it("Lv2 (cores=2) + ネクサス2コア (amount=4 に不足): 全額支払い不能 → rollback (コア変化なし・破壊不発火)", () => {
    const state = setup(2, 2);
    const result = executeEffect({
      chainId: "test:bsth01-xx02-attack-lv4-release:172",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "reimu-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const reimu = result.cardInstances.find((x) => x.instanceId === "reimu-1")!;
    expect(reimu.normalCoreCount).toBe(2);
    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(2);
    const enemy = result.cardInstances.find((x) => x.instanceId === "enemy-1")!;
    expect(enemy.pendingLeaveKind).toBeNull();
    expect(enemy.zone).toBe("field");
  });
});
