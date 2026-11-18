/**
 * P3-43 producer: `Effect.preventionLevel`（「相手の効果では防げない」）の DSL → 登録 →
 * 実行への配線テスト。
 *
 * 背景: `unpreventable` の **consumer**（executeDestroy/Vanish 等が cannot_*・defense_immune
 * を貫通する）は P3-43 で実装済み（p3-43-unpreventable-cannot-clash.test.ts）だが、
 * それを駆動する **producer**（カード DSL から sourcePreventionLevel を立てる経路）が
 * 欠けており、どのカードも「防げない」にできなかった。本テストは新設した
 * `Effect.preventionLevel` フィールドが
 *   1. registration 生成器（getEffectPreventionLevel が読む producer）に伝搬し、
 *   2. executeEffect 経由の実行で対象の効果耐性を貫通して盤面を変える、
 * ことを 2 枚の実カード（BSSG01-X02 破壊 / BSLH01-T09 消滅）で確認する。
 */
import { describe, it, expect } from "vitest";
import { acceptOptionalSteps } from "./crossover-fidelity-test-helpers";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "../src";
import {
  generateTriggeredEffectRegistrations,
  generateMagicRegistrations,
} from "../src/effect/structured-effect-registrations";
import { getEffectPreventionLevel } from "../src/legal/legal-actions-shared";
import type {
  CardDefinition,
  ContinuousEffect,
  ContinuousEffectTag,
  Effect,
  GameState,
} from "../src/model";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}

/**
 * 対象が「実際に離脱する」かを判定する。離脱系アクションは即時にゾーンを移さず
 * pendingLeaveEntities に積む（SBA flush でゾーン移動）ため、ゾーン離脱と
 * 「resistance で阻まれていない pendingLeave」のいずれかで真とする。
 * blockedByResistance:true（阻止された待機）はフィールド残存なので偽。
 */
function isLeaving(result: GameState, id: string): boolean {
  const c = result.cardInstances.find((x) => x.instanceId === id);
  const leftField = !c || c.zone !== "field";
  const realLeave = result.pendingLeaveEntities.some(
    (e) => e.instanceId === id && !e.blockedByResistance
  );
  return leftField || realLeave;
}

/** 相手起因の cannot_* 効果耐性 CE を対象 instance に直接付与する。 */
function cannotLeaveCE(
  targetInstanceId: string,
  tag: ContinuousEffectTag,
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: `test-${tag}-${targetInstanceId}`,
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "permanent" },
    createdAtTurn: 0,
    createdAtAttackId: null,
    modifierTag: tag,
    targetInstanceId,
    metadata: { source: "opponent_effect" },
  };
}

describe("P3-43 producer: BSSG01-X02 月読 調「シャルシャガナ-EX-」破壊 (防げない)", () => {
  const def = card("BSSG01-X02");
  // effects[1] = 『煌臨/ブロック時』相手2体破壊+発揮させない+回復。相手の効果で防げない。
  const destroyEffectIndex = 1;

  it("triggered registration が preventionLevel: unpreventable を立てる", () => {
    const regs = generateTriggeredEffectRegistrations(def).filter(
      (r) => r.effectIndex === destroyEffectIndex
    );
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expect(getEffectPreventionLevel(reg)).toBe("unpreventable");
    }
  });

  function makeState(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(def, {
      instanceId: "src-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 3,
      exhaustState: "exhausted",
    });
    // 相手スピリットに「相手の効果で破壊されない」を付与。
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "enemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
      activeContinuousEffects: [
        cannotLeaveCE("enemy-1", "cannot_be_destroyed", "bob"),
      ],
    };
  }

  it("control: preventionLevel 無しの破壊は cannot_be_destroyed に阻まれ残存", () => {
    const plain: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "destroy",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 2,
            },
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:p3-43-unpreventable-producer:141",
      state: makeState(),
      effect: plain,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "enemy-1")).toBe(false);
  });

  it("unpreventable の破壊は cannot_be_destroyed を貫通して相手スピリットを破壊", () => {
    let result = executeEffect({
      chainId: "test:p3-43-unpreventable-producer:152",
      state: makeState(),
      effect: def.effects![destroyEffectIndex]!,
      sourceInstanceId: "src-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    result = acceptOptionalSteps(result, getCardDefinitionById, {
      targetInstanceIds: ["enemy-1"],
    });
    expect(isLeaving(result, "enemy-1")).toBe(true);
  });
});

describe("P3-43 producer: BSLH01-T09 上級攻撃アーツ 消滅 (防げない)", () => {
  const def = card("BSLH01-T09");
  // 【アーツ】配置ゲートは CardDefinition.summonCondition へ移動。
  // effects[0]=系統CB/導力器以外の自分の効果を受けない,
  // effects[1]=フラッシュ 相手3体消滅。これらの効果は相手の効果では防げない。
  const vanishEffectIndex = 1;

  it("magic registration が preventionLevel: unpreventable を立てる", () => {
    const regs = generateMagicRegistrations(def).filter(
      (r) => r.preventionLevel !== undefined
    );
    expect(regs.length).toBeGreaterThan(0);
    for (const reg of regs) {
      expect(getEffectPreventionLevel(reg)).toBe("unpreventable");
    }
  });

  function makeState(): GameState {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const self = createCardInstance(def, {
      instanceId: "arts-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      normalCoreCount: 0,
    });
    const enemy = createCardInstance(card("BSSG01-C01"), {
      instanceId: "venemy-1",
      ownerPlayerId: "bob",
      controllerPlayerId: "bob",
      zone: "field",
      normalCoreCount: 1,
    });
    return {
      ...base,
      activePlayerId: "alice",
      step: "main",
      cardInstances: [self, enemy],
      activeContinuousEffects: [
        cannotLeaveCE("venemy-1", "cannot_be_vanished", "bob"),
      ],
    };
  }

  it("control: preventionLevel 無しの消滅は cannot_be_vanished に阻まれ残存", () => {
    const plain: Effect = {
      timing: { kind: "activated", mode: "flash" },
      steps: [
        {
          action: {
            kind: "vanish",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit", "ultimate"] },
              count: 3,
            },
          },
        },
      ],
    };
    const result = executeEffect({
      chainId: "test:p3-43-unpreventable-producer:227",
      state: makeState(),
      effect: plain,
      sourceInstanceId: "arts-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "venemy-1")).toBe(false);
  });

  it("unpreventable の消滅は cannot_be_vanished を貫通して相手スピリットを消滅", () => {
    const result = executeEffect({
      chainId: "test:p3-43-unpreventable-producer:238",
      state: makeState(),
      effect: def.effects![vanishEffectIndex]!,
      sourceInstanceId: "arts-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
    });
    expect(isLeaving(result, "venemy-1")).toBe(true);
  });
});
