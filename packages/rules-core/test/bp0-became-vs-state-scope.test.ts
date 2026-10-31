/**
 * P3-104: 「BP0になった」(因果/遷移) と「BP0の」(状態) の対象スコープ。
 *
 * 本文「BP-Xし、BP0になった対象を破壊/デッキ下」の正しい意味は
 * 「この効果の BP マイナスで 0 以下に至った対象」だけ。
 * 一方、「BPが0の」型は現在 BP0 の対象を盤面再スキャンする状態型として扱う。
 *
 * 裁定: 公式 Q&A Q192（既に BP0 の体に BP- しても「BP0になった」効果は発揮しない）が
 * 遷移セマンティクスを確定。設計: 10_rules/03c §「BP0になった」, issues/archive/P3-104。
 */
import { describe, expect, it } from "vitest";
import { ALL_CARDS } from "../../card-data/src/generated-index";
import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  flushPendingLeaves,
} from "../src";
import type { CardDefinition, GameState } from "../src";

const cardNoMap = new Map<string, CardDefinition>(
  ALL_CARDS.map((c) => [c.cardNo, c])
);
const getCardDefinitionById = (id: string) => cardNoMap.get(id);

const mariDef = cardNoMap.get("BSTH02-X04")!;
const marisaDef = cardNoMap.get("BSTH01-X02")!;
const vanillaDef = cardNoMap.get("BSDB01-C02")!; // BP5000 のバトルしていない相手スピリット

const combinedHostDef: CardDefinition = {
  cardNo: "P3-104-COMBINED-HOST",
  name: "P3-104 combined host",
  printedCategory: "spirit",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const combinedBraveDef: CardDefinition = {
  cardNo: "P3-104-COMBINED-BRAVE",
  name: "P3-104 combined brave",
  printedCategory: "brave",
  colors: ["red"],
  cost: 3,
  reductionSymbols: [],
  levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
  symbolColors: ["red"],
  textLines: [],
  keywordTags: [],
  sourceUrls: [],
  sourceConfidence: "C",
};

const getCardDefinitionByIdWithSynthetic = (id: string) =>
  id === combinedHostDef.cardNo
    ? combinedHostDef
    : id === combinedBraveDef.cardNo
      ? combinedBraveDef
      : getCardDefinitionById(id);

/**
 * mari(lv2) + 相手 A(tgt-1, BP5000) + 相手 B(tgt-2, BP5000 だが別原因で実効 BP0)。
 * B は「このターン -5000」継続効果(CE)で 0 に張り付くが、SBA 破壊は起きず場に残る。
 */
function setup(): GameState {
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  const mari = createCardInstance(mariDef, {
    instanceId: "mari-1",
    ownerPlayerId: "alice",
    controllerPlayerId: "alice",
    zone: "field",
    level: 2,
    normalCoreCount: 3,
  });
  const spiritA = createCardInstance(vanillaDef, {
    instanceId: "tgt-1",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const spiritB = createCardInstance(vanillaDef, {
    instanceId: "tgt-2",
    ownerPlayerId: "bob",
    controllerPlayerId: "bob",
    zone: "field",
    normalCoreCount: 1,
  });
  const preExistingZeroCe: GameState["activeContinuousEffects"][number] = {
    effectId: "ce-prepark-tgt2",
    sourceInstanceId: "aura-src",
    sourceDefinitionId: "dsl-unknown",
    actingPlayerId: "alice",
    duration: { scope: "turn" },
    createdAtTurn: base.turnNumber,
    createdAtAttackId: null,
    modifierTag: "bp_modifier",
    modifierAmount: -5000,
    targetInstanceId: "tgt-2",
  };
  return {
    ...base,
    activePlayerId: "alice",
    step: "attack",
    cardInstances: [mari, spiritA, spiritB],
    activeContinuousEffects: [
      ...base.activeContinuousEffects,
      preExistingZeroCe,
    ],
  };
}

describe("P3-104 「BP0になった」 vs 「現在BP0」 の対象スコープ", () => {
  it("前提: B は別原因の継続 -5000 で実効 BP0、まだ場に残っている", () => {
    const state = setup();
    const b = state.cardInstances.find((c) => c.instanceId === "tgt-2")!;
    expect(b.zone).toBe("field");
  });

  it("BP-10000 を A だけに撃ったとき、BP0になった A だけをデッキ下に戻す", () => {
    const state = setup();
    const result = flushPendingLeaves(
      executeEffect({
        chainId: "test:bp0-became-vs-state-scope:129",
        state,
        effect: mariDef.effects![2]!, // attack: BP-10000(1体) → send_to_deck bp_became_zero ref
        sourceInstanceId: "mari-1",
        actingPlayerId: "alice",
        getCardDefinitionById,
        targetInstanceIds: ["tgt-1"], // bp_modify を A に固定
      }),
      getCardDefinitionById
    );
    const a = result.cardInstances.find((c) => c.instanceId === "tgt-1")!;
    const b = result.cardInstances.find((c) => c.instanceId === "tgt-2")!;
    // A はこの効果で 0 以下になった → デッキ下（正しい）
    expect(a.zone).toBe("deck");
    // B はこの効果が触っていない既存 0 体 → 「BP0になった」対象ではないため残る。
    expect(b.zone).toBe("field");
  });

  it("既に BP0 の B だけに BP-10000 を撃ったとき、後段 ref は空 no-op になる", () => {
    const state = setup();
    const result = executeEffect({
      chainId: "test:bp0-became-vs-state-scope:149",
      state,
      effect: mariDef.effects![2]!,
      sourceInstanceId: "mari-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["tgt-2"],
    });
    const source = result.cardInstances.find((c) => c.instanceId === "mari-1")!;
    const a = result.cardInstances.find((c) => c.instanceId === "tgt-1")!;
    const b = result.cardInstances.find((c) => c.instanceId === "tgt-2")!;
    expect(source.zone).toBe("field");
    expect(a.zone).toBe("field");
    expect(b.zone).toBe("field");
    expect(result.log.some((l) => l.startsWith("effect:send_to_deck:"))).toBe(
      false
    );
  });

  it("状態型『BPが0の』は効果前から BP0 の対象も破壊する", () => {
    const base = setup();
    const source = createCardInstance(marisaDef, {
      instanceId: "marisa-1",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 3,
      normalCoreCount: 4,
    });
    const state: GameState = {
      ...base,
      cardInstances: [
        source,
        ...base.cardInstances.filter((c) => c.instanceId !== "mari-1"),
      ],
    };

    const result = executeEffect({
      chainId: "test:bp0-became-vs-state-scope:186",
      state,
      effect: marisaDef.effects![2]!, // attack: BP-3000(1体) → BPが0の全体を破壊
      sourceInstanceId: "marisa-1",
      actingPlayerId: "alice",
      getCardDefinitionById,
      targetInstanceIds: ["tgt-1"], // A は BP5000→2000、B は効果前から実効 BP0
    });
    const a = result.cardInstances.find((c) => c.instanceId === "tgt-1")!;
    const b = result.cardInstances.find((c) => c.instanceId === "tgt-2")!;
    expect(a.zone).toBe("field");
    expect(b.pendingLeaveKind === "destroy" || b.zone === "trash").toBe(true);
  });

  it("合体スピリットはブレイヴBP+込みで BP0 遷移を判定する", () => {
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const source = createCardInstance(mariDef, {
      instanceId: "mari-combined-test",
      ownerPlayerId: "alice",
      controllerPlayerId: "alice",
      zone: "field",
      level: 2,
      normalCoreCount: 3,
    });
    const host = {
      ...createCardInstance(combinedHostDef, {
        instanceId: "combined-host",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 1,
      }),
      attachedChildrenIds: ["combined-brave"],
    };
    const brave = {
      ...createCardInstance(combinedBraveDef, {
        instanceId: "combined-brave",
        ownerPlayerId: "bob",
        controllerPlayerId: "bob",
        zone: "field",
        normalCoreCount: 0,
      }),
      attachedToInstanceId: "combined-host",
    };
    const state: GameState = {
      ...base,
      activePlayerId: "alice",
      step: "attack",
      cardInstances: [source, host, brave],
    };
    const bpMinusThenDestroyBecameZero: NonNullable<
      CardDefinition["effects"]
    >[number] = {
      timing: { kind: "card_event", event: "attack" },
      steps: [
        {
          id: "bp0",
          action: {
            kind: "bp_modify",
            target: {
              kind: "filter",
              player: "opponent",
              filter: { category: ["spirit"] },
              count: 1,
            },
            amount: -5000,
            duration: { scope: "turn" },
          },
        },
        {
          action: {
            kind: "destroy",
            target: { kind: "ref", stepId: "bp0", result: "bp_became_zero" },
          },
        },
      ],
    };

    const result = executeEffect({
      chainId: "test:bp0-became-vs-state-scope:264",
      state,
      effect: bpMinusThenDestroyBecameZero,
      sourceInstanceId: "mari-combined-test",
      actingPlayerId: "alice",
      getCardDefinitionById: getCardDefinitionByIdWithSynthetic,
      targetInstanceIds: ["combined-host"],
    });
    const hostAfter = result.cardInstances.find(
      (c) => c.instanceId === "combined-host"
    )!;
    expect(hostAfter.zone).toBe("field");
    expect(hostAfter.pendingLeaveKind ?? undefined).toBeUndefined();
    expect(result.log.some((l) => l.startsWith("effect:destroy:"))).toBe(false);
  });
});
