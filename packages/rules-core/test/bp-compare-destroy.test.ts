/**
 * `bp_compare_destroy` プリミティブ検証。
 *
 * 「AとBのBPを比べ、BPが同じか低い方が破壊される」型（源＝このスピリット vs 選択した相手 1 体）。
 * 動的 BP 比較破壊は BSAZ02 / BSKB01 / BSLH01 等に共通する engine ギャップだった。
 * ルール正源は各カード本文（「BPが同じか低い…が破壊される」）。同値は両側が「同じか低い」を
 * 満たすため両方破壊する。破壊は通常破壊（queuePendingLeave → pendingLeaveKind="destroy"）。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import type {
  CardDefinition,
  GameState,
  Effect,
  ContinuousEffect,
} from "../src";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
function card(no: string): CardDefinition {
  const c = cardNoMap.get(no);
  if (!c) throw new Error(`card not found: ${no}`);
  return c;
}
const getDef = (id: string): CardDefinition | undefined => cardNoMap.get(id);
const noTriggerLookup = () => [];

const ALICE = "player-1";
const BOB = "player-2";

const compareEffect: Effect = {
  timing: { kind: "card_event", event: "attack" },
  steps: [
    {
      action: {
        kind: "bp_compare_destroy",
        target: {
          kind: "filter",
          player: "opponent",
          filter: { category: ["spirit", "ultimate"] },
          count: 1,
        },
      },
    },
  ],
};

function run(state: GameState, sourceInstanceId: string): GameState {
  return executeEffect({
    chainId: "test:bp-compare-destroy:52",
    state,
    effect: compareEffect,
    sourceInstanceId,
    actingPlayerId: ALICE,
    getCardDefinitionById: getDef,
    getRegisteredTriggeredEffectActions: noTriggerLookup,
  });
}

// 既知 BP（Lv1 / normalCoreCount:1）: 孫悟空 BSDB01-C01=4000 / クリリン C05=2000 / ベジータ C02=5000。
function srcGoku() {
  return createCardInstance(card("BSDB01-C01"), {
    instanceId: "src-goku",
    ownerPlayerId: ALICE,
    zone: "field",
    normalCoreCount: 1, // Lv1 → BP 4000
  });
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

function dynamicCannotBeDestroyedBlueCE(
  ownerPlayerId: string
): ContinuousEffect {
  return {
    effectId: "ce-dynamic-blue-cannot-destroy",
    sourceInstanceId: "test-source",
    sourceDefinitionId: "test-def",
    actingPlayerId: ownerPlayerId,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "cannot_be_destroyed",
    targetFilter: { player: "self", colors: ["blue"] },
    metadata: { source: "opponent" },
  };
}

function treatAsBlueCE(targetInstanceId: string): ContinuousEffect {
  return {
    effectId: `ce-treat-blue-${targetInstanceId}`,
    sourceInstanceId: targetInstanceId,
    sourceDefinitionId: "test-def",
    actingPlayerId: ALICE,
    duration: { scope: "while_on_field" },
    createdAtTurn: 1,
    createdAtAttackId: null,
    modifierTag: "treat_as_color",
    targetInstanceId,
    modifierSymbol: ["blue"],
  };
}

describe("bp_compare_destroy（動的 BP 比較破壊：源 vs 選択対象）", () => {
  it("相手が低い（2000 ≤ 4000）: 相手のみ破壊・源は残る", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C05"), {
      instanceId: "opp-krillin",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 2000
    });
    const after = run(
      createEmptyGameState({ cardInstances: [src, opp] }),
      "src-goku"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-krillin")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.pendingLeaveEntities.find((pl) => pl.instanceId === "opp-krillin")
    ).toMatchObject({ cause: "bp_compare", causePlayerId: ALICE });
  });

  it("相手が高い（5000 > 4000）: 源のみ破壊・相手は残る", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C02"), {
      instanceId: "opp-vegeta",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 5000
    });
    const after = run(
      createEmptyGameState({ cardInstances: [src, opp] }),
      "src-goku"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-vegeta")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.pendingLeaveEntities.find((pl) => pl.instanceId === "src-goku")
    ).toMatchObject({ cause: "bp_compare", causePlayerId: BOB });
  });

  it("源が低い場合の source:'opponent' 破壊耐性: BP勝者を原因プレイヤーとして阻止する", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C02"), {
      instanceId: "opp-vegeta",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 5000
    });
    const base = createEmptyGameState({ cardInstances: [src, opp] });
    const after = run(
      {
        ...base,
        activeContinuousEffects: [
          cannotBeDestroyedByOpponentCE("src-goku", ALICE),
        ],
      },
      "src-goku"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-vegeta")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.pendingLeaveEntities.find((pl) => pl.instanceId === "src-goku")
    ).toMatchObject({
      kind: "destroy",
      cause: "bp_compare",
      causePlayerId: BOB,
      blockedByResistance: true,
    });
  });

  it("動的 effect_resistance の colors filter は treat_as_color 後の実効色で判定する", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C02"), {
      instanceId: "opp-vegeta",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 5000
    });
    const base = createEmptyGameState({ cardInstances: [src, opp] });
    const after = run(
      {
        ...base,
        activeContinuousEffects: [
          dynamicCannotBeDestroyedBlueCE(ALICE),
          treatAsBlueCE("src-goku"),
        ],
      },
      "src-goku"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBeNull();
    expect(
      after.pendingLeaveEntities.find((pl) => pl.instanceId === "src-goku")
    ).toMatchObject({
      kind: "destroy",
      cause: "bp_compare",
      causePlayerId: BOB,
      blockedByResistance: true,
    });
  });

  it("同値（4000 = 4000）: 「同じか低い」を両側が満たし両方破壊", () => {
    const src = srcGoku();
    const opp = createCardInstance(card("BSDB01-C01"), {
      instanceId: "opp-goku",
      ownerPlayerId: BOB,
      zone: "field",
      normalCoreCount: 1, // BP 4000（同値）
    });
    const after = run(
      createEmptyGameState({ cardInstances: [src, opp] }),
      "src-goku"
    );
    expect(
      after.cardInstances.find((x) => x.instanceId === "opp-goku")!
        .pendingLeaveKind
    ).toBe("destroy");
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBe("destroy");
  });

  it("対象不在: 何も起きない（fail-closed、源も残る）", () => {
    const src = srcGoku();
    const after = run(
      createEmptyGameState({ cardInstances: [src] }),
      "src-goku"
    );
    expect(after.pendingLeaveEntities.length).toBe(0);
    expect(
      after.cardInstances.find((x) => x.instanceId === "src-goku")!
        .pendingLeaveKind
    ).toBeNull();
  });
});
