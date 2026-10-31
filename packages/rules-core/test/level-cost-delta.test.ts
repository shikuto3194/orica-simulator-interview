/**
 * Lv コスト加算修飾（override_properties.levelCostDelta）の primitive テスト。
 *
 * 「相手のスピリット/アルティメットすべての Lv コスト+N」型（BSKB01-M01 /
 * BSLH01-M04 / BSSL01-X03）の基盤を検証する:
 *  - filter target(count:"all") は動的メンバーシップの global CE を 1 件登録する。
 *  - getEffectiveLevel が各レベル閾値の必要コア数に delta を一律加算する。
 *  - 最低 Lv コストを満たせなくなったスピリットは SBA 消滅判定の対象になる。
 *
 * 根拠: 10_rules/03a:71（Lvコストを増やす効果が適用されている場合は増加後コスト分が必要）/
 *       10_rules/04:105（消滅 = コアが最低 Lv コスト未満）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  collectStateBasedActions,
  createCardInstance,
  createEmptyGameState,
  getEffectiveLevel,
  getEffectiveLevelCostDelta,
  rebuildContinuousEffectsFromField,
} from "../src";
import type { CardDefinition, ContinuousEffect, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const ベリオン = cardNoMap.get("BSSL01-X03");
const メタナイト = cardNoMap.get("BSKB01-M01");
const シャーリー = cardNoMap.get("BSLH01-M04");

/** 被影響対象用の標準スピリット (BSSL01-M01 キバ: levelDefs lv1=1/lv2=3/lv3=4)。 */
const 被害スピリット = cardNoMap.get("BSSL01-M01");

function makeGlobalLevelCostDeltaCE(
  delta: number,
  player: "self" | "opponent"
): ContinuousEffect {
  return {
    effectId: "test-lvcost-delta",
    sourceInstanceId: "source",
    sourceDefinitionId: "BSSL01-X03",
    actingPlayerId: "alice",
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "override_properties",
    targetFilter: { player, category: ["spirit", "ultimate"] },
    metadata: { properties: { levelCostDelta: delta } },
  };
}

describe("levelCostDelta primitive (Lv コスト加算修飾)", () => {
  it("対象カードが card-data に存在する", () => {
    expect(ベリオン).toBeDefined();
    expect(メタナイト).toBeDefined();
    expect(シャーリー).toBeDefined();
    expect(被害スピリット).toBeDefined();
  });

  it("filter global CE で相手スピリットの実効 Lv が下がる (3コア: Lv2→Lv1)", () => {
    const base: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(被害スピリット!, {
          instanceId: "victim",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };
    const victim = base.cardInstances[0]!;

    // delta なし: 3 コアで Lv2 (lv1=1 / lv2=3)。
    expect(
      getEffectiveLevel(base, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(2);

    // delta +2 (相手対象): 閾値 lv1=3 / lv2=5 となり 3 コアでは Lv1。
    const withCe: GameState = {
      ...base,
      activeContinuousEffects: [makeGlobalLevelCostDeltaCE(2, "opponent")],
    };
    expect(
      getEffectiveLevelCostDelta(
        withCe,
        victim,
        被害スピリット!,
        getCardDefinitionById
      )
    ).toBe(2);
    expect(
      getEffectiveLevel(withCe, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(1);
  });

  it("instance 直付け CE (BSKB01-M01 型: 単一対象 nexus) の delta が加算される", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const victim = createCardInstance(被害スピリット!, {
      instanceId: "instance-victim",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const instanceCe: ContinuousEffect = {
      effectId: "inst-lvcost",
      sourceInstanceId: "metaknight",
      sourceDefinitionId: "BSKB01-M01",
      actingPlayerId: "alice",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "override_properties",
      targetInstanceId: "instance-victim",
      metadata: { properties: { levelCostDelta: 2 } },
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      cardInstances: [victim],
      activeContinuousEffects: [instanceCe],
    };
    expect(
      getEffectiveLevelCostDelta(
        state,
        victim,
        被害スピリット!,
        getCardDefinitionById
      )
    ).toBe(2);
    // 3 コア: lv1=3 / lv2=5 → Lv1。
    expect(
      getEffectiveLevel(state, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(1);
  });

  it("delta が最低 Lv コストを上回ると SBA 消滅判定の対象になる", () => {
    const base: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(被害スピリット!, {
          instanceId: "victim2",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    };
    // delta なし: 1 コアは最低 Lv コスト (lv1=1) を満たすので消滅しない。
    const noDelta = collectStateBasedActions(base, getCardDefinitionById);
    expect(
      noDelta.some(
        (c) =>
          c.kind === "vanish_due_to_core_deficit" && c.instanceId === "victim2"
      )
    ).toBe(false);

    // delta +2: 最低 Lv コストが 3 になり 1 コアでは消滅判定。
    const withCe: GameState = {
      ...base,
      activeContinuousEffects: [makeGlobalLevelCostDeltaCE(2, "opponent")],
    };
    const sba = collectStateBasedActions(withCe, getCardDefinitionById);
    expect(
      sba.some(
        (c) =>
          c.kind === "vanish_due_to_core_deficit" && c.instanceId === "victim2"
      )
    ).toBe(true);
  });

  it("BSSL01-X03 ベリオン Lv2 + 自ターンで相手スピリットへ levelCostDelta global CE を登録する", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [
        // ベリオン (levelDefs lv1=1/lv2=2/lv3=4)。2 コアで Lv2。
        createCardInstance(ベリオン!, {
          instanceId: "berion",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        // 相手スピリット (3 コア → 通常 Lv2)。
        createCardInstance(被害スピリット!, {
          instanceId: "oppvictim",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };

    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const lvCostCes = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        typeof (ce.metadata?.properties as Record<string, unknown> | undefined)
          ?.levelCostDelta === "number"
    );
    expect(lvCostCes.length).toBeGreaterThanOrEqual(1);
    expect(
      lvCostCes.some(
        (ce) =>
          ce.targetFilter !== undefined && ce.targetInstanceId === undefined
      )
    ).toBe(true);

    // 相手スピリットの実効 Lv が +2 で Lv2→Lv1 に下がる。
    const victim = rebuilt.cardInstances.find(
      (c) => c.instanceId === "oppvictim"
    )!;
    expect(
      getEffectiveLevel(rebuilt, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(1);

    const lateVictim = createCardInstance(被害スピリット!, {
      instanceId: "oppvictim-late",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 3,
    });
    const withLateVictim: GameState = {
      ...rebuilt,
      cardInstances: [...rebuilt.cardInstances, lateVictim],
    };
    expect(
      getEffectiveLevelCostDelta(
        withLateVictim,
        lateVictim,
        被害スピリット!,
        getCardDefinitionById
      )
    ).toBe(2);
    expect(
      getEffectiveLevel(
        withLateVictim,
        lateVictim,
        被害スピリット!,
        getCardDefinitionById
      )
    ).toBe(1);
  });

  it("ベリオンが Lv1 (1コア) のときは levelCostDelta CE を登録しない (min_level 2 unmet)", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(ベリオン!, {
          instanceId: "berion-lv1",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(被害スピリット!, {
          instanceId: "oppvictim2",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const lvCostCes = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        typeof (ce.metadata?.properties as Record<string, unknown> | undefined)
          ?.levelCostDelta === "number"
    );
    expect(lvCostCes).toHaveLength(0);

    const victim = rebuilt.cardInstances.find(
      (c) => c.instanceId === "oppvictim2"
    )!;
    expect(
      getEffectiveLevel(rebuilt, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(2);
  });

  it("〔重複不可〕同名・同コントローラーのベリオン2体でも levelCostDelta global CE は1件のみ", () => {
    // BSSL01-X03 effects[3] は usageLimit:{kind:"no_duplicate"} を持つ。
    // 同じコントローラーの同名スピリットが複数いても CE は 1 体ぶんしか活性化しない
    // (10_rules/03c §〔重複不可〕、effect-interpreter 継続効果 dedup が SSOT)。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      cardInstances: [
        createCardInstance(ベリオン!, {
          instanceId: "berion-a",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(ベリオン!, {
          instanceId: "berion-b",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(被害スピリット!, {
          instanceId: "oppvictim-dup",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const lvCostCes = rebuilt.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag === "override_properties" &&
        typeof (ce.metadata?.properties as Record<string, unknown> | undefined)
          ?.levelCostDelta === "number"
    );
    // 〔重複不可〕で 1 件に dedup される (2 体ぶん登録されない)。
    expect(lvCostCes).toHaveLength(1);
    expect(
      rebuilt.log.some((l) => l.startsWith("effect:no-duplicate-skipped:"))
    ).toBe(true);

    // 効果自体は活きており、相手スピリットの実効 Lv は +2 で Lv2→Lv1。
    const victim = rebuilt.cardInstances.find(
      (c) => c.instanceId === "oppvictim-dup"
    )!;
    expect(
      getEffectiveLevel(rebuilt, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(1);
  });

  it("BSSL01-X03 effects[3] は no_duplicate と unpreventable リダーを data で持つ", () => {
    // 「相手の効果で防げない」(blanket) = preventionLevel:"unpreventable"、
    // 〔重複不可〕= usageLimit:{kind:"no_duplicate"} を Effect 直配する。
    const eff = ベリオン!.effects?.find(
      (e) =>
        Array.isArray(e.textRef) &&
        e.textRef.join(",") === "5,6" &&
        e.steps.some(
          (s) =>
            s.action?.kind === "override_properties" &&
            (s.action.properties as Record<string, unknown> | undefined)
              ?.levelCostDelta === 2
        )
    );
    expect(eff).toBeDefined();
    expect(eff!.preventionLevel).toBe("unpreventable");
    const limits = Array.isArray(eff!.usageLimit)
      ? eff!.usageLimit
      : eff!.usageLimit
        ? [eff!.usageLimit]
        : [];
    expect(limits.some((u) => u.kind === "no_duplicate")).toBe(true);
  });

  it("相手ターンではベリオンの levelCostDelta が消費側 (timingScope self) で無効化される", () => {
    // timingScope は登録時でなく消費時 (getGlobalCEs) で評価されるため、CE は登録され得るが
    // 相手ターンでは getEffectiveLevelCostDelta が 0 を返し、実効 Lv は下がらない。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "bob",
      cardInstances: [
        createCardInstance(ベリオン!, {
          instanceId: "berion-opp-turn",
          ownerPlayerId: "alice",
          controllerPlayerId: "alice",
          zone: "field",
          normalCoreCount: 2,
        }),
        createCardInstance(被害スピリット!, {
          instanceId: "oppvictim3",
          ownerPlayerId: "bob",
          controllerPlayerId: "bob",
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    };
    const rebuilt = rebuildContinuousEffectsFromField(
      state,
      getCardDefinitionById
    );
    const victim = rebuilt.cardInstances.find(
      (c) => c.instanceId === "oppvictim3"
    )!;
    expect(
      getEffectiveLevelCostDelta(
        rebuilt,
        victim,
        被害スピリット!,
        getCardDefinitionById
      )
    ).toBe(0);
    // 相手ターンなので実効 Lv は素のまま (3 コア = Lv2)。
    expect(
      getEffectiveLevel(rebuilt, victim, 被害スピリット!, getCardDefinitionById)
    ).toBe(2);
  });
});
