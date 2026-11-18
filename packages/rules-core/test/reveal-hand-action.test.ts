import { describe, it, expect } from "vitest";
import { createEmptyGameState, createCardInstance } from "../src/factories";
import { executeEffect } from "../src/effect/effect-interpreter";
import type { CardDefinition, CardInstance, GameState } from "../src/model";
import type { Effect } from "../src/dsl-types";

const ALICE = "player-1";
const BOB = "player-2";

function def(
  cardNo: string,
  overrides: Partial<CardDefinition> = {}
): CardDefinition {
  return {
    cardNo,
    name: cardNo,
    printedCategory: "spirit",
    printedColors: ["red"],
    symbolColors: ["red"],
    printedCost: 3,
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    textLines: [],
    images: {},
    tribe: "",
    colors: ["red"],
    ...overrides,
  } as CardDefinition;
}

const defMap = new Map<string, CardDefinition>();
defMap.set(
  "SPIRIT-R",
  def("SPIRIT-R", { colors: ["red"], printedCategory: "spirit" })
);
defMap.set(
  "SPIRIT-B",
  def("SPIRIT-B", { colors: ["blue"], printedCategory: "spirit" })
);
defMap.set(
  "MAGIC-R",
  def("MAGIC-R", { colors: ["red"], printedCategory: "magic" })
);
defMap.set(
  "NEXUS-R",
  def("NEXUS-R", { colors: ["red"], printedCategory: "nexus" })
);

function getCardDef(id: string): CardDefinition | undefined {
  return defMap.get(id);
}

function handCard(
  instanceId: string,
  owner: string,
  definitionId = "SPIRIT-R"
): CardInstance {
  return createCardInstance(defMap.get(definitionId)!, {
    instanceId,
    ownerPlayerId: owner,
    zone: "hand",
  });
}

function runEffect(state: GameState, effect: Effect): GameState {
  return executeEffect({
    chainId: "test:reveal-hand-action:67",
    state,
    effect,
    sourceInstanceId: "src",
    actingPlayerId: ALICE,
    getCardDefinitionById: getCardDef,
  });
}

describe("P3-14 A-3: reveal_hand action", () => {
  it("player=opponent + revealTo=self で対戦相手の手札を効果オーナーに公開する", () => {
    const bob1 = handCard("bob-h-1", BOB, "SPIRIT-R");
    const bob2 = handCard("bob-h-2", BOB, "MAGIC-R");
    const state = createEmptyGameState({
      cardInstances: [bob1, bob2],
      playerOverrides: [{}, { handCount: 2 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: { kind: "reveal_hand", player: "opponent", revealTo: "self" },
        },
      ],
    };

    const result = runEffect(state, effect);

    // カードのゾーンは変化しない
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-h-1")?.zone
    ).toBe("hand");
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-h-2")?.zone
    ).toBe("hand");
    // 手札枚数も変化しない
    expect(result.players.find((p) => p.id === BOB)?.handCount).toBe(2);
    // log に公開記録が残る
    const revealLog = result.log.find((l) => l.includes("effect:reveal_hand"));
    expect(revealLog).toBeDefined();
    expect(revealLog).toContain(`:${BOB}:`);
    expect(revealLog).toContain("revealTo=self");
    expect(revealLog).toContain("count=2");
    expect(revealLog).toContain("bob-h-1");
    expect(revealLog).toContain("bob-h-2");
  });

  it("filter 指定時は該当カードのみが公開対象になる", () => {
    const bob1 = handCard("bob-spirit", BOB, "SPIRIT-R");
    const bob2 = handCard("bob-magic", BOB, "MAGIC-R");
    const bob3 = handCard("bob-nexus", BOB, "NEXUS-R");
    const state = createEmptyGameState({
      cardInstances: [bob1, bob2, bob3],
      playerOverrides: [{}, { handCount: 3 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "reveal_hand",
            player: "opponent",
            revealTo: "self",
            filter: { category: ["spirit"] },
          },
        },
      ],
    };

    const result = runEffect(state, effect);

    const revealLog = result.log.find((l) => l.includes("effect:reveal_hand"));
    expect(revealLog).toBeDefined();
    expect(revealLog).toContain("count=1");
    expect(revealLog).toContain("bob-spirit");
    expect(revealLog).not.toContain("bob-magic");
    expect(revealLog).not.toContain("bob-nexus");
  });

  it("revealTo=both で両者に公開する", () => {
    const alice1 = handCard("alice-h", ALICE, "SPIRIT-R");
    const state = createEmptyGameState({
      cardInstances: [alice1],
      playerOverrides: [{ handCount: 1 }, {}],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "reveal_hand", revealTo: "both" } }],
    };

    const result = runEffect(state, effect);

    const revealLog = result.log.find((l) => l.includes("effect:reveal_hand"));
    expect(revealLog).toBeDefined();
    expect(revealLog).toContain(`:${ALICE}:`);
    expect(revealLog).toContain("revealTo=both");
    expect(revealLog).toContain("count=1");
  });

  it("player 未指定時は actingPlayerId（self）の手札が対象になる", () => {
    const alice1 = handCard("alice-self-h", ALICE, "SPIRIT-R");
    const bob1 = handCard("bob-other-h", BOB, "SPIRIT-R");
    const state = createEmptyGameState({
      cardInstances: [alice1, bob1],
      playerOverrides: [{ handCount: 1 }, { handCount: 1 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [{ action: { kind: "reveal_hand", revealTo: "opponent" } }],
    };

    const result = runEffect(state, effect);

    const revealLog = result.log.find((l) => l.includes("effect:reveal_hand"));
    expect(revealLog).toBeDefined();
    expect(revealLog).toContain(`:${ALICE}:`);
    expect(revealLog).toContain("alice-self-h");
    expect(revealLog).not.toContain("bob-other-h");
  });

  it("手札が空のときは no-op（log に公開記録が残らない）", () => {
    const state = createEmptyGameState({
      cardInstances: [],
      playerOverrides: [{}, { handCount: 0 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: { kind: "reveal_hand", player: "opponent", revealTo: "self" },
        },
      ],
    };

    const result = runEffect(state, effect);

    expect(result.log.some((l) => l.includes("effect:reveal_hand"))).toBe(
      false
    );
  });

  it("filter 非マッチ時も no-op（log に公開記録が残らない）", () => {
    const bob1 = handCard("bob-magic-only", BOB, "MAGIC-R");
    const state = createEmptyGameState({
      cardInstances: [bob1],
      playerOverrides: [{}, { handCount: 1 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          action: {
            kind: "reveal_hand",
            player: "opponent",
            revealTo: "self",
            filter: { category: ["spirit"] },
          },
        },
      ],
    };

    const result = runEffect(state, effect);

    expect(result.log.some((l) => l.includes("effect:reveal_hand"))).toBe(
      false
    );
  });

  it("後続 discard と組み合わせて『相手の手札を見て、その中のスピリットカード1枚を破棄する』を表現可能", () => {
    // BSKB01-TX01(B) 相当パターン: reveal_hand (opponent → self) → discard (opponent, spirit, 1)
    const bobSpirit = handCard("bob-spirit", BOB, "SPIRIT-R");
    const bobMagic = handCard("bob-magic", BOB, "MAGIC-R");
    const state = createEmptyGameState({
      cardInstances: [bobSpirit, bobMagic],
      playerOverrides: [{}, { handCount: 2 }],
    });

    const effect: Effect = {
      timing: { kind: "activated", mode: "main" },
      steps: [
        {
          id: "reveal",
          action: {
            kind: "reveal_hand",
            player: "opponent",
            revealTo: "self",
            filter: { category: ["spirit"] },
          },
        },
        {
          action: {
            kind: "discard",
            count: 1,
            player: "opponent",
            filter: { category: ["spirit"] },
          },
          connector: "sequential",
        },
      ],
    };

    const result = runEffect(state, effect);

    // reveal_hand は log 追加のみ
    expect(result.log.some((l) => l.includes("effect:reveal_hand"))).toBe(true);
    // 後続 discard: スピリットのみが破棄対象（候補 1 枚 = count ぴったり → 即時破棄）
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-spirit")?.zone
    ).toBe("trash");
    expect(
      result.cardInstances.find((c) => c.instanceId === "bob-magic")?.zone
    ).toBe("hand");
  });
});
