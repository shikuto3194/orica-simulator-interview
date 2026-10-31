/**
 * BSTH02-X02 西行寺 幽々子 effects[1] 『このスピリットのアタック時』vanish + 界放:3 検証。
 *
 * 原文 (textLines[3,4]):
 *   "Lv2-Lv3『このスピリットのアタック時』"
 *   "相手のスピリット/アルティメット1体を消滅させる。この効果で消滅するスピリット/アルティメットの
 *    コアは、相手がリザーブ/トラッシュに置く。さらに、自分の紫の導界者ネクサスのコア3個を
 *    このスピリットに置くことで、このターンの間、このスピリットに紫のシンボル2つを追加する。"
 *
 * SSOT 流用: BSTH01-XX02 effects[1] (BSTH01.ts:3322-3361) と同型の界放パターン
 *   (core_move from:field_card 自分の導界者ネクサス → to:this_card amount:N → 後段
 *    benefit を conditional_cost で gate)。
 *
 * 検証ポイント (shape):
 *   - step0 = vanish opponent spirit/ultimate ×1
 *   - step1 = core_move from field_card (self purple 導界者 nexus) → this_card amount:3
 *             + connector:simultaneous (前段 vanish と独立な「さらに」副節の cost step)
 *   - step2 = symbol_add purple turn + connector:conditional_cost (benefit gated by step1)
 *   - step3 = symbol_add purple turn + connector:simultaneous (2 個目)
 *
 * 挙動 (happy path):
 *   - 紫の導界者ネクサス 1 つに 3 コア配置 + Lv2 + 相手スピ 1 体:
 *     → vanish 成立 (相手スピ消滅) + 自カードに 3 コア追加 + symbol_addition CE 2 件登録
 *
 * 挙動 (fail-closed):
 *   - 紫の導界者ネクサス 1 つに 2 コアしかない + Lv2 + 相手スピ 1 体:
 *     → vanish は成立、core_move 不能 → conditional_cost で symbol_add 2 件不発火
 *
 * 消滅時コアの「相手がリザーブ/トラッシュに置く」= VanishAction.coreDestinationChoice
 * (ENGINE-vanish-action-core-destination-opponent-choice) で配線。対象のコントローラー
 * (=このカードの「相手」) が既存の core_move splitDestinations 選択機構
 * (`pendingCoreSplitSelection`) で reserve/trash へ自由配分する。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import type { CardDefinition, GameState } from "../src";
import { getLegalActions } from "../src/legal/legal-actions";
import { applyLegalAction as rawApplyLegalAction } from "../src/legal/legal-actions-apply";
import { finishPayloadInputs } from "./helpers/payload-input-driver";
import { flushPendingLeaves } from "../src";
function applyLegalAction(options: Parameters<typeof rawApplyLegalAction>[0]) {
  const result = rawApplyLegalAction(options);
  return {
    ...result,
    state: finishPayloadInputs(result.state, options.getCardDefinitionById),
  };
}

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

describe("BSTH02-X02 西行寺 幽々子 effects[1] アタック時 vanish + 界放:3", () => {
  const c = cardNoMap.get("BSTH02-X02")!;
  const guideNexus = cardNoMap.get("BSTH02-X01")!; // 紫の導界者ネクサス「西行妖」
  const opponentSpirit = cardNoMap.get("BSTH02-C01")!; // 任意のスピリット

  // ========== shape 検証 ==========
  it("timing card_event:attack + condition min_level:2", () => {
    const e = c.effects![1]!;
    expect(e.timing).toEqual({ kind: "card_event", event: "attack" });
    expect(e.condition).toEqual([{ kind: "min_level", value: 2 }]);
  });

  it("step0 = vanish opponent spirit/ultimate ×1", () => {
    const e = c.effects![1]!;
    const step0 = e.steps[0]!;
    expect(step0.action.kind).toBe("vanish");
    if (step0.action.kind === "vanish") {
      expect(step0.action.target).toEqual({
        kind: "filter",
        player: "opponent",
        filter: { category: ["spirit", "ultimate"] },
        count: 1,
      });
    }
  });

  it("step1 = core_move from field_card self purple guided nexus → this_card amount:3 (simultaneous)", () => {
    const e = c.effects![1]!;
    const step1 = e.steps[1]!;
    expect(step1.action.kind).toBe("core_move");
    if (step1.action.kind === "core_move") {
      expect(step1.action.from).toEqual({
        kind: "field_card",
        player: "self",
        filter: {
          category: ["nexus"],
          colors: ["purple"],
          tribes: ["導界者"],
          targetsGrandwalker: true,
        },
      });
      expect(step1.action.to).toEqual({ kind: "this_card" });
      expect(step1.action.amount).toBe(3);
    }
    expect(step1.connector).toBe("simultaneous");
  });

  it("step2 = symbol_add purple turn + connector conditional_cost", () => {
    const e = c.effects![1]!;
    const step2 = e.steps[2]!;
    expect(step2.action.kind).toBe("symbol_add");
    if (step2.action.kind === "symbol_add") {
      expect(step2.action.target).toEqual({ kind: "self" });
      expect(step2.action.symbol).toBe("purple");
      expect(step2.action.duration).toEqual({ scope: "turn" });
    }
    expect(step2.connector).toBe("conditional_cost");
  });

  it("step3 = symbol_add purple turn + connector conditional_cost (合計+2、cost 連鎖 gate)", () => {
    const e = c.effects![1]!;
    const step3 = e.steps[3]!;
    expect(step3.action.kind).toBe("symbol_add");
    if (step3.action.kind === "symbol_add") {
      expect(step3.action.symbol).toBe("purple");
      expect(step3.action.duration).toEqual({ scope: "turn" });
    }
    expect(step3.connector).toBe("conditional_cost");
  });

  it("step0 = vanish に coreDestinationChoice(reserve/trash) が付与されている", () => {
    const e = c.effects![1]!;
    const step0 = e.steps[0]!;
    if (step0.action.kind === "vanish") {
      expect(step0.action.coreDestinationChoice).toEqual({
        options: ["reserve", "trash"],
      });
    }
    expect(e.stub).toBeUndefined();
  });

  // ========== 挙動検証 ==========
  function setup(
    yuyukoNormalCores: number,
    nexusCores: number,
    enemyNormalCores = 1
  ) {
    const base = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const yuyuko = createCardInstance(c, {
      instanceId: "yuyuko-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: yuyukoNormalCores,
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
      normalCoreCount: enemyNormalCores,
    });
    return {
      ...base,
      cardInstances: [yuyuko, nexus, enemy],
    } as GameState;
  }

  /**
   * enemy は normalCoreCount:1 (デフォルト) で場に出ているため vanish が
   * `pendingCoreSplitSelection` (bob の reserve/trash 選択待ち) を生成し、
   * 効果の残りステップ (界放:3 副節) は選択解決まで中断する。ここでは
   * 界放コスト/benefit の検証が主目的なので、bob の選択を機械的に解決 (全 reserve) して
   * 効果の完了状態を得る (opponent-choice 自体の検証は下の専用 describe を参照)。
   */
  function resolvePendingVanishCoreSplitToReserve(state: GameState): GameState {
    if (!state.pendingCoreSplitSelection) return state;
    const split = getLegalActions({
      state,
      actingPlayerId: state.pendingCoreSplitSelection.actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).find((a) => a.kind === "resolve_pending_core_split")!;
    return applyLegalAction({
      state,
      action: split,
      coreSplitDistribution: [state.pendingCoreSplitSelection.totalAmount, 0],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
  }

  it("Lv2 + 紫導界者ネクサス 3 コア: vanish + 自カードに 3 コア + 紫シンボル+2 (turn CE)", () => {
    // Lv2 = 3 cores required
    const state = setup(3, 3);
    const result = resolvePendingVanishCoreSplitToReserve(
      executeEffect({
        chainId: "test:bsth02-x02-attack-divine-release:195",
        state,
        effect: c.effects![1]!,
        sourceInstanceId: "yuyuko-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      })
    );
    // 相手スピリットは vanish (pendingLeave を経て field から消える/消滅予定)
    const enemy = result.cardInstances.find((x) => x.instanceId === "enemy-1")!;
    // vanish は pendingLeave を立てる SBR pattern
    expect(enemy.pendingLeaveKind === "vanish" || enemy.zone !== "field").toBe(
      true
    );
    // 界放:3 cost — 自カードのコアが +3 (元 3 → 6)
    const yuyuko = result.cardInstances.find(
      (x) => x.instanceId === "yuyuko-1"
    )!;
    expect(yuyuko.normalCoreCount).toBe(6);
    // 紫導界者ネクサスのコアが -3 (元 3 → 0)
    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(0);
    // symbol_add CE が yuyuko に対し 2 件登録される (turn duration)
    const symbolCEs = result.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.sourceInstanceId === "yuyuko-1"
    );
    expect(symbolCEs.length).toBe(2);
  });

  it("Lv2 + 紫導界者ネクサス 2 コア (不足): conditional_cost で symbol_add 不発火, vanish は成立", () => {
    const state = setup(3, 2);
    const result = resolvePendingVanishCoreSplitToReserve(
      executeEffect({
        chainId: "test:bsth02-x02-attack-divine-release:229",
        state,
        effect: c.effects![1]!,
        sourceInstanceId: "yuyuko-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
      })
    );
    // vanish は step0 で実行済 (前段 simultaneous との独立性により)
    const enemy = result.cardInstances.find((x) => x.instanceId === "enemy-1")!;
    expect(enemy.pendingLeaveKind === "vanish" || enemy.zone !== "field").toBe(
      true
    );
    // 自カードのコア変化なし
    const yuyuko = result.cardInstances.find(
      (x) => x.instanceId === "yuyuko-1"
    )!;
    expect(yuyuko.normalCoreCount).toBe(3);
    // 紫導界者ネクサスのコア変化なし (rollback)
    const nexus = result.cardInstances.find((x) => x.instanceId === "nexus-1")!;
    expect(nexus.normalCoreCount).toBe(2);
    // symbol_add CE 不発火
    const symbolCEs = result.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.sourceInstanceId === "yuyuko-1"
    );
    expect(symbolCEs.length).toBe(0);
  });

  // ========== 挙動検証: 消滅時コアの「相手がリザーブ/トラッシュに置く」 ==========
  const noTriggerLookup = () => [];

  it("vanish 対象 (相手コントロール) のコアは pendingCoreSplitSelection で bob 選択待ちになる (自動 reserve credit されない)", () => {
    const state = setup(3, 3, 2);
    const result = executeEffect({
      chainId: "test:bsth02-x02-attack-divine-release:264",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "yuyuko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    // 相手 (bob) が選択者 = 「この効果で消滅する…コアは、相手がリザーブ/トラッシュに置く」
    expect(result.pendingCoreSplitSelection).toMatchObject({
      actingPlayerId: "bob",
      sourceInstanceId: "enemy-1",
      totalAmount: 2,
      fromLocation: { kind: "card_instance", instanceId: "enemy-1" },
      destinations: [
        { location: { kind: "reserve", player: "self" } },
        { location: { kind: "trash", player: "self" } },
      ],
    });
    // 選択が解決するまで vanish の flush (フィールド離脱) は据え置き、コアも enemy 上のまま。
    const enemy = result.cardInstances.find((x) => x.instanceId === "enemy-1")!;
    expect(enemy.zone).toBe("field");
    expect(enemy.pendingLeaveKind).toBe("vanish");
    expect(enemy.normalCoreCount).toBe(2);
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const bob = result.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(bobBefore.reserveNormalCoreCount);
    expect(bob.trashNormalCoreCount).toBe(bobBefore.trashNormalCoreCount);
  });

  it("bob が全コアをリザーブへ選択: bob のリザーブ+2、enemy は場を離れコア0", () => {
    const state = setup(3, 3, 2);
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const afterEffect = executeEffect({
      chainId: "test:bsth02-x02-attack-divine-release:296",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "yuyuko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const split = getLegalActions({
      state: afterEffect,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_core_split");
    expect(split).toBeDefined();
    const resolved = applyLegalAction({
      state: afterEffect,
      action: split!,
      coreSplitDistribution: [2, 0],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    expect(resolved.pendingCoreSplitSelection).toBeNull();
    const bob = resolved.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 2
    );
    expect(bob.trashNormalCoreCount).toBe(bobBefore.trashNormalCoreCount);
    const enemy = resolved.cardInstances.find(
      (x) => x.instanceId === "enemy-1"
    )!;
    expect(enemy.normalCoreCount).toBe(0);
    expect(enemy.zone).not.toBe("field");
    // 「さらに」の界放:3 副節も選択解決後に resume される (前段が独立な conditional_cost なし
    // simultaneous 節のため、界放コスト不足なら symbol_add は不発火だが nexus 3 コアあり = 発火)。
    const yuyuko = resolved.cardInstances.find(
      (x) => x.instanceId === "yuyuko-1"
    )!;
    expect(yuyuko.normalCoreCount).toBe(6);
    const symbolCEs = resolved.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "symbol_addition" &&
        ce.sourceInstanceId === "yuyuko-1"
    );
    expect(symbolCEs.length).toBe(2);
  });

  it("bob がコアを分割 (トラッシュ1/リザーブ1) 選択: 自由配分できる", () => {
    const state = setup(3, 3, 2);
    const bobBefore = state.players.find((p) => p.id === "bob")!;
    const afterEffect = executeEffect({
      chainId: "test:bsth02-x02-attack-divine-release:346",
      state,
      effect: c.effects![1]!,
      sourceInstanceId: "yuyuko-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    const split = getLegalActions({
      state: afterEffect,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).find((a) => a.kind === "resolve_pending_core_split")!;
    const resolved = applyLegalAction({
      state: afterEffect,
      action: split,
      coreSplitDistribution: [1, 1],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: noTriggerLookup,
    }).state;

    const bob = resolved.players.find((p) => p.id === "bob")!;
    expect(bob.reserveNormalCoreCount).toBe(
      bobBefore.reserveNormalCoreCount + 1
    );
    expect(bob.trashNormalCoreCount).toBe(bobBefore.trashNormalCoreCount + 1);
    const enemy = resolved.cardInstances.find(
      (x) => x.instanceId === "enemy-1"
    )!;
    expect(enemy.normalCoreCount).toBe(0);
    expect(enemy.zone).not.toBe("field");
  });
  for (const [mode, title] of [
    [
      "decline",
      "BSTH02-X02: decline optional tail keeps the independent vanish",
    ],
    [
      "execute",
      "BSTH02-X02: execute optional tail keeps the independent vanish",
    ],
    [
      "unavailable",
      "BSTH02-X02: unavailable optional tail keeps the independent vanish",
    ],
  ] as const)
    it(title, () => {
      const before = setup(3, mode === "unavailable" ? 2 : 3);
      const raw = executeEffect({
        state: before,
        effect: c.effects![1]!,
        effectIndex: 1,
        chainId: `tail:BSTH02-X02:${mode}`,
        sourceInstanceId: "yuyuko-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: () => [],
      });
      const after = flushPendingLeaves(
        finishPayloadInputs(
          raw,
          getCardDefinitionById,
          mode === "decline" ? "decline" : "execute"
        ),
        getCardDefinitionById
      );
      expect(c.effects![1]!.executionMode ?? "mandatory").toBe("mandatory");
      expect(c.effects![1]!.steps[1]!.executionMode).toBe("optional");
      expect(
        after.cardInstances.find((card) => card.instanceId === "enemy-1")?.zone
      ).toBe("trash");
      expect(
        after.cardInstances.find((card) => card.instanceId === "yuyuko-1")
          ?.normalCoreCount
      ).toBe(mode === "execute" ? 6 : 3);
      expect(
        after.cardInstances.find((card) => card.instanceId === "nexus-1")
          ?.normalCoreCount
      ).toBe(mode === "execute" ? 0 : mode === "unavailable" ? 2 : 3);
      expect(
        after.activeContinuousEffects.filter(
          (e) => e.modifierTag === "symbol_addition"
        )
      ).toHaveLength(mode === "execute" ? 2 : 0);
    });
});
